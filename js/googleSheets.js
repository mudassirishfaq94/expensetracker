/* =========================================================================
   googleSheets.js — Google Sheets synchronization layer (Part 4)
   Bridges the app and a Google Apps Script Web App, which writes to a
   spreadsheet. Responsible for:

     - connection config + status
     - test connection
     - sending / updating / deleting transactions
     - sync-all + retry logic
     - a small local queue for failed remote deletions
     - the Google Apps Script code the user pastes into their spreadsheet

   LocalStorage stays the immediate data source; this module never stores
   credentials (no API keys, no OAuth tokens — only the Web App URL and names).

   The Apps Script checks IDs before adding rows, so refreshes and retries
   never create duplicates.

   Attaches to: window.ET.sheets
   ========================================================================= */
(function (global) {
  "use strict";

  var ET = (global.ET = global.ET || {});
  var storage = ET.storage;

  var STATUS_PENDING = "pending";
  var STATUS_SYNCED = "synced";
  var STATUS_FAILED = "failed";

  /* Google Apps Script the user pastes into Extensions → Apps Script.
     Deployment: Run as Me, Who has access: Anyone. */
  var APP_SCRIPT_CODE = [
    "/**",
    " * Ledger — Google Sheets sync backend.",
    " * Paste into Extensions → Apps Script (Code.gs),",
    " * then Deploy → New deployment → Web app.",
    " *   Execute as:  Me",
    " *   Who has access: Anyone",
    " * Copy the Web App URL into Ledger's Google Sheets settings.",
    " */",
    "",
    "function doPost(e) {",
    "  var result = { success: false, message: \"Unknown action\" };",
    "  try {",
    "    if (!e || !e.postData) throw new Error(\"No request body received\");",
    "    var payload = JSON.parse(e.postData.contents);",
    "    var sheet = getSheet_(payload.sheetName || \"Transactions\");",
    "    var action = payload.action;",
    "",
    "    if (action === \"testConnection\") {",
    "      result = { success: true, message: \"Connected successfully\" };",
    "    } else if (action === \"addTransaction\" || action === \"updateTransaction\") {",
    "      result = upsertRow_(sheet, payload.transaction);",
    "    } else if (action === \"deleteTransaction\") {",
    "      result = deleteRow_(sheet, payload.id);",
    "    } else if (action === \"getTransactions\") {",
    "      result = getAll_(sheet);",
    "    } else {",
    "      result = { success: false, message: \"Unknown action: \" + action };",
    "    }",
    "  } catch (err) {",
    "    result = { success: false, message: \"Error: \" + err.message };",
    "  }",
    "  return ContentService.createTextOutput(JSON.stringify(result))",
    "    .setMimeType(ContentService.MimeType.JSON);",
    "}",
    "",
    "function getSheet_(name) {",
    "  var ss = SpreadsheetApp.getActiveSpreadsheet();",
    "  var sh = ss.getSheetByName(name);",
    "  if (!sh) sh = ss.insertSheet(name);",
    "  ensureHeaders_(sh);",
    "  return sh;",
    "}",
    "",
    "function ensureHeaders_(sh) {",
    "  var headers = [\"ID\",\"Type\",\"Title\",\"Amount\",\"Currency\",\"Category\",\"Vendor/Source\",\"Date\",\"Notes\",\"Created At\",\"Updated At\",\"Sync Status\"];",
    "  var first = sh.getRange(1, 1, 1, headers.length).getValues()[0];",
    "  if (String(first[0] || \"\") !== \"ID\") {",
    "    sh.getRange(1, 1, 1, headers.length).setValues([headers]);",
    "    sh.setFrozenRows(1);",
    "  }",
    "}",
    "",
    "function findRowByID_(sh, id) {",
    "  var last = sh.getLastRow();",
    "  if (last < 2) return -1;",
    "  var ids = sh.getRange(2, 1, last - 1, 1).getValues();",
    "  for (var i = 0; i < ids.length; i++) {",
    "    if (String(ids[i][0]) === String(id)) return i + 2;",
    "  }",
    "  return -1;",
    "}",
    "",
    "function upsertRow_(sh, txn) {",
    "  if (!txn || !txn.id) return { success: false, message: \"Transaction is missing an ID\" };",
    "  var row = findRowByID_(sh, txn.id);",
    "  var values = [",
    "    String(txn.id),",
    "    (txn.type === \"income\" ? \"Income\" : \"Expense\"),",
    "    String(txn.title || \"\"),",
    "    Number(txn.amount) || 0,",
    "    String(txn.currency || \"AED\"),",
    "    String(txn.category || \"\"),",
    "    String(txn.vendor || \"\"),",
    "    String(txn.date || \"\"),",
    "    String(txn.notes || \"\"),",
    "    String(txn.createdAt != null ? new Date(txn.createdAt).toISOString() : \"\"),",
    "    String(txn.updatedAt != null ? new Date(txn.updatedAt).toISOString() : \"\"),",
    "    \"Synced\"",
    "  ];",
    "  if (row === -1) {",
    "    sh.appendRow(values);",
    "    return { success: true, message: \"Transaction added successfully\" };",
    "  }",
    "  sh.getRange(row, 1, 1, values.length).setValues([values]);",
    "  return { success: true, message: \"Transaction updated successfully\" };",
    "}",
    "",
    "function deleteRow_(sh, id) {",
    "  var row = findRowByID_(sh, id);",
    "  if (row === -1) {",
    "    return { success: true, message: \"No matching row to delete\" };",
    "  }",
    "  sh.deleteRow(row);",
    "  return { success: true, message: \"Transaction deleted successfully\" };",
    "}",
    "",
    "function getAll_(sh) {",
    "  var last = sh.getLastRow();",
    "  if (last < 2) return { success: true, message: \"\", data: [] };",
    "  var values = sh.getRange(2, 1, last - 1, 12).getValues();",
    "  var headers = [\"id\",\"type\",\"title\",\"amount\",\"currency\",\"category\",\"vendor\",\"date\",\"notes\",\"createdAt\",\"updatedAt\",\"syncStatus\"];",
    "  var rows = values.map(function (r) {",
    "    var obj = {};",
    "    headers.forEach(function (h, i) { obj[h] = r[i]; });",
    "    return obj;",
    "  });",
    "  return { success: true, message: \"\", data: rows };",
    "}"
  ].join("\n");

  /* ------------------------------- config ------------------------------ */

  function getConfig() {
    return storage.getSheetsConfig() || {};
  }

  function saveConfig(config) {
    config = config || {};
    if (!config.savedAt) config.savedAt = Date.now();
    storage.saveSheetsConfig(config);
    return config;
  }

  function clearConfig() {
    return storage.clearSheetsConfig();
  }

  function validateUrl(url) {
    if (!url) return false;
    if (typeof URL === "function") {
      try {
        var u = new URL(url);
        return u.protocol === "https:";
      } catch (err) {
        return false;
      }
    }
    return /^https:\/\/\S+/.test(url);
  }

  /* Connected = saved URL that has actually worked (test or sync succeeded). */
  function isConnected() {
    var c = getConfig();
    return !!(c.webAppUrl && validateUrl(c.webAppUrl) &&
      (c.lastTestOk === true || c.lastSyncedAt != null));
  }

  /* URL present and syntactically valid (used to enable sync buttons/retry). */
  function hasValidUrl() {
    var c = getConfig();
    return !!(c.webAppUrl && validateUrl(c.webAppUrl));
  }

  function setLastSync() {
    var c = getConfig();
    if (c.webAppUrl) {
      c.lastSyncedAt = Date.now();
      c.lastTestOk = true;
      c.lastError = null;
      saveConfig(c);
    }
  }

  function rememberFailure(message) {
    var c = getConfig();
    if (c.webAppUrl) {
      c.lastError = message;
      c.lastTestOk = false;
      saveConfig(c);
    }
  }

  /* ------------------------------ transport ---------------------------- */

  function postJson(url, payload) {
    var controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    var timer = controller ? setTimeout(function () { controller.abort(); }, 15000) : null;
    var opts = {
      method: "POST",
      redirect: "follow",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload)
    };
    if (controller) opts.signal = controller.signal;

    return global.fetch(url, opts).then(function (res) {
      if (timer) clearTimeout(timer);
      return res.text().then(function (text) {
        var parsed = null;
        try { parsed = JSON.parse(text); } catch (err) { parsed = null; }
        if (parsed && typeof parsed.success === "boolean") {
          return { ok: true, success: parsed.success, message: parsed.message || "", data: parsed.data || null };
        }
        return { ok: false, success: false, message: "The script returned an unexpected response. Check the Web App URL." };
      });
    }).catch(function (err) {
      if (timer) clearTimeout(timer);
      if (err && err.name === "AbortError") {
        return { ok: false, success: false, message: "Connection timed out." };
      }
      return { ok: false, success: false, message: "Could not reach Google Sheets. Check your internet connection." };
    });
  }

  /* ------------------------------ payload ------------------------------ */

  function serialize(record) {
    return {
      id: String(record.id || ""),
      type: storage.normalizeType(record.type),
      title: String(record.title || ""),
      amount: Number(record.amount) || 0,
      currency: String(record.currency || storage.DEFAULT_CURRENCY),
      category: String(record.category || ""),
      vendor: String(record.vendor || ""),
      date: String(record.date || ""),
      notes: String(record.notes || ""),
      createdAt: record.createdAt != null ? new Date(record.createdAt).toISOString() : "",
      updatedAt: record.updatedAt != null ? new Date(record.updatedAt).toISOString() : ""
    };
  }

  function setStatus(id, status) {
    storage.update(id, { syncStatus: status });
  }

  function markPending(id) {
    setStatus(id, STATUS_PENDING);
  }

  /* ------------------------------- actions ----------------------------- */

  function testConnection(config) {
    config = config || getConfig();
    if (!config.webAppUrl) {
      return Promise.resolve({ ok: false, success: false, message: "Please paste your Web App URL first." });
    }
    if (!validateUrl(config.webAppUrl)) {
      return Promise.resolve({ ok: false, success: false, message: "Invalid Web App URL." });
    }
    return postJson(config.webAppUrl, {
      action: "testConnection",
      spreadsheetName: config.spreadsheetName || "",
      sheetName: config.sheetName || "Transactions"
    });
  }

  /**
   * Send (or update) one transaction. Adds when it has never synced, updates
   * when it was already synced. The Apps Script still dedupes by ID either
   * way, so no duplicate rows are ever created.
   */
  function syncTransaction(record) {
    var cfg = getConfig();
    if (!cfg.webAppUrl || !validateUrl(cfg.webAppUrl)) {
      return Promise.resolve({ ok: true, success: false, message: "Google Sheets is not connected.", skipped: true });
    }
    var action = record.syncStatus === STATUS_SYNCED ? "updateTransaction" : "addTransaction";
    var payload = { action: action, transaction: serialize(record) };
    return postJson(cfg.webAppUrl, payload).then(function (r) {
      if (r.success) {
        setStatus(record.id, STATUS_SYNCED);
        setLastSync();
      } else {
        setStatus(record.id, STATUS_FAILED);
        rememberFailure(r.message);
      }
      return r;
    });
  }

  /** Sync every transaction that isn't already synced. Returns a summary. */
  function syncAll() {
    if (!hasValidUrl()) {
      return Promise.resolve({ synced: 0, failed: 0, skipped: 0, connected: false });
    }
    return retryPendingDeletes().then(function () {
      var targets = storage.getAll().filter(function (r) {
        return r.syncStatus !== STATUS_SYNCED;
      });
      var summary = { synced: 0, failed: 0, skipped: 0, connected: true };
      return targets.reduce(function (chain, record) {
        return chain.then(function () {
          return syncTransaction(record).then(function (r) {
            if (r.success) summary.synced++;
            else if (r.skipped) summary.skipped++;
            else summary.failed++;
          });
        });
      }, Promise.resolve()).then(function () {
        return summary;
      });
    });
  }

  /* Same behaviour — used after connecting with existing local transactions. */
  function syncExisting() {
    return syncAll();
  }

  function deleteRemoteTransaction(id) {
    var cfg = getConfig();
    if (!hasValidUrl()) {
      return Promise.resolve({ ok: true, success: false, message: "Google Sheets is not connected.", skipped: true });
    }
    return postJson(cfg.webAppUrl, { action: "deleteTransaction", id: String(id) }).then(function (r) {
      if (r.success) setLastSync();
      return r;
    });
  }

  /* -------------------- failed-deletion retry queue -------------------- */

  function queueRemoteDelete(id) {
    var list = storage.getPendingRemoteDeletes();
    if (list.indexOf(id) === -1) list.push(id);
    storage.savePendingRemoteDeletes(list);
  }

  function clearRemoteDelete(id) {
    storage.savePendingRemoteDeletes(
      storage.getPendingRemoteDeletes().filter(function (x) { return x !== id; })
    );
  }

  function retryPendingDeletes() {
    var ids = storage.getPendingRemoteDeletes();
    if (!ids.length) return Promise.resolve({ removed: 0, failed: 0 });
    var summary = { removed: 0, failed: 0 };
    return ids.reduce(function (chain, id) {
      return chain.then(function () {
        return deleteRemoteTransaction(id).then(function (r) {
          if (r.success) {
            clearRemoteDelete(id);
            summary.removed++;
          } else {
            summary.failed++;
          }
        });
      });
    }, Promise.resolve()).then(function () { return summary; });
  }

  /* ------------------------------ public API --------------------------- */

  ET.sheets = {
    APP_SCRIPT_CODE: APP_SCRIPT_CODE,
    STATUS_PENDING: STATUS_PENDING,
    STATUS_SYNCED: STATUS_SYNCED,
    STATUS_FAILED: STATUS_FAILED,

    getConfig: getConfig,
    saveConfig: saveConfig,
    clearConfig: clearConfig,
    validateUrl: validateUrl,
    isConnected: isConnected,
    hasValidUrl: hasValidUrl,

    testConnection: testConnection,
    syncTransaction: syncTransaction,
    syncAll: syncAll,
    syncExisting: syncExisting,
    markPending: markPending,
    deleteRemoteTransaction: deleteRemoteTransaction,
    queueRemoteDelete: queueRemoteDelete,
    retryPendingDeletes: retryPendingDeletes
  };
})(window);
