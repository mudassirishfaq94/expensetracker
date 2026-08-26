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
   never create duplicates. It also formats the Transactions sheet and keeps a
   Summary sheet of live formulas (Part 4.5).

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
     Deployment: Run as Me, Who has access: Anyone.
     - Dedupes transactions by ID (add updates instead of duplicating)
     - Auto-formats headers, column widths, dates, amounts and type tints
     - Maintains a "Summary" sheet with live formulas
     - initializeSpreadsheet() is safe to run again at any time */
  var APP_SCRIPT_CODE = `/**
 * Ledger — Google Sheets sync backend.
 * Paste into Extensions → Apps Script (Code.gs), then
 * Deploy → New deployment → Web app.
 *   Execute as:        Me
 *   Who has access:    Anyone
 * Copy the Web App URL into Ledger's Google Sheets settings.
 *
 * What this script does:
 *  - Stores transactions in the "Transactions" sheet, one row each, deduped by ID
 *  - Auto-formats headers, column widths, dates, amounts and income/expense tints
 *  - Maintains a "Summary" sheet with live formulas (overall, current month,
 *    statistics, category breakdowns, monthly table)
 *  - initializeSpreadsheet() is safe to run again — it never deletes data
 */

var COLUMNS = ["ID","Type","Title","Amount","Currency","Category","Vendor/Source","Date","Notes","Created At","Updated At","Sync Status"];
var WIDTHS = [180, 100, 220, 120, 90, 180, 200, 120, 250, 180, 180, 120];
var DATE_FORMAT = "dd mmm yyyy";
var DATETIME_FORMAT = "dd mmm yyyy, hh:mm AM/PM";
var AMOUNT_FORMAT = "#,##0.00";
/* Summary totals are currency-neutral because transactions can use different
   currencies — each row's currency lives in its own column on the sheet. */
var SUMMARY_CURRENCY_FORMAT = "#,##0.00";
var HEADER_BG = "#0E3B2C";

function doPost(e) {
  var result = { success: false, message: "Unknown action" };
  try {
    if (!e || !e.postData) throw new Error("No request body received");
    var payload = JSON.parse(e.postData.contents);
    var sheetName = payload.sheetName || "Transactions";
    var sh = getSheet_(sheetName);
    var action = payload.action;

    if (action === "testConnection") {
      initializeSpreadsheet_(sh, sheetName);
      result = { success: true, message: "Connected successfully" };
    } else if (action === "addTransaction" || action === "updateTransaction") {
      var out = upsertRow_(sh, payload.transaction);
      result = out
        ? { success: true, message: out.created ? "Transaction added successfully" : "Transaction updated successfully" }
        : { success: false, message: "Transaction is missing an ID" };
    } else if (action === "deleteTransaction") {
      result = deleteRow_(sh, payload.id);
    } else if (action === "getTransactions") {
      result = getAll_(sh);
    } else {
      result = { success: false, message: "Unknown action: " + action };
    }
  } catch (err) {
    result = { success: false, message: "Error: " + err.message };
  }
  return ContentService.createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

/* --------------------------- sheet retrieval --------------------------- */

function getSheet_(name) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.setTabColor("#1E6B4F");
  }
  ensureHeaders_(sh);
  ensureReady_(sh, name);
  return sh;
}

function ensureHeaders_(sh) {
  var first = sh.getRange(1, 1, 1, COLUMNS.length).getValues()[0];
  if (String(first[0] || "") !== "ID") {
    sh.getRange(1, 1, 1, COLUMNS.length).setValues([COLUMNS]);
    sh.setFrozenRows(1);
  }
}

/* Format the workbook once the sheet has not been styled yet. */
function ensureReady_(sh, name) {
  var bg = sh.getRange(1, 1).getBackground();
  if (String(bg).toUpperCase() !== HEADER_BG) {
    initializeSpreadsheet_(sh, name);
  }
}

/* ------------------------- public initializer -------------------------- */

function initializeSpreadsheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = getSheet_("Transactions");
  initializeSpreadsheet_(sh, "Transactions");
  Logger.log("Ledger spreadsheet initialized.");
}

function initializeSpreadsheet_(sh, sheetName) {
  ensureHeaders_(sh);
  ensureFilter_(sh);
  fixExistingData_(sh);
  formatHeader_(sh);
  setWidths_(sh);
  setFormats_(sh);
  backfillHelpers_(sh);
  applyConditionalFormatting_(sh);
  buildSummary_();
}

/* Add a filter to the header row so users can sort/filter the ledger. */
function ensureFilter_(sh) {
  if (!sh.getFilter()) {
    sh.getRange(1, 1, 1, COLUMNS.length).createFilter();
  }
}

/* --------------------------- data migration ---------------------------- */

function fixExistingData_(sh) {
  var last = sh.getLastRow();
  if (last < 2) return;
  var numRows = last - 1;
  var data = sh.getRange(2, 1, numRows, COLUMNS.length).getValues();
  for (var i = 0; i < data.length; i++) {
    var row = data[i];
    if (row[1] === "income") row[1] = "Income";
    if (row[1] === "expense") row[1] = "Expense";
    if (typeof row[3] === "string") {
      var n = parseFloat(String(row[3]).replace(/[^0-9.-]/g, ""));
      if (!isNaN(n)) row[3] = n;
    }
    row[7] = toDate_(row[7]);    // Date
    row[9] = toDate_(row[9]);    // Created At
    row[10] = toDate_(row[10]);  // Updated At
  }
  sh.getRange(2, 1, numRows, COLUMNS.length).setValues(data);
}

function toDate_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) return value;
  if (typeof value === "number") return new Date(value);
  if (typeof value === "string") {
    var s = String(value).trim();
    var m = /^(\\d{4})-(\\d{1,2})-(\\d{1,2})$/.exec(s);
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    var t = Date.parse(s);
    if (!isNaN(t)) return new Date(t);
  }
  return value;
}

/* ----------------------------- formatting ------------------------------ */

function formatHeader_(sh) {
  var r = sh.getRange(1, 1, 1, COLUMNS.length);
  r.setBackground(HEADER_BG)
    .setFontColor("#FFFFFF")
    .setFontWeight("bold")
    .setFontSize(11)
    .setHorizontalAlignment("center")
    .setVerticalAlignment("middle")
    .setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);
  r.setBorder(true, true, true, true, true, true, "#C8D6CD", SpreadsheetApp.BorderStyle.SOLID);
  sh.setRowHeight(1, 34);
}

function setWidths_(sh) {
  for (var i = 0; i < WIDTHS.length; i++) {
    sh.setColumnWidth(i + 1, WIDTHS[i]);
  }
}

function setFormats_(sh) {
  var last = Math.max(sh.getLastRow(), 2);
  var n = Math.max(last - 1, 1);
  sh.getRange(2, 4, n, 1).setNumberFormat(AMOUNT_FORMAT);           // Amount
  sh.getRange(2, 5, n, 1).setHorizontalAlignment("center");          // Currency
  sh.getRange(2, 8, n, 1).setNumberFormat(DATE_FORMAT);              // Date
  sh.getRange(2, 10, n, 1).setNumberFormat(DATETIME_FORMAT);         // Created At
  sh.getRange(2, 11, n, 1).setNumberFormat(DATETIME_FORMAT);         // Updated At
  sh.getRange(2, 2, n, 1).setHorizontalAlignment("center");          // Type
  sh.getRange(2, 3, n, 1).setWrapStrategy(SpreadsheetApp.WrapStrategy.WRAP);   // Title
  sh.getRange(2, 7, n, 1).setWrapStrategy(SpreadsheetApp.WrapStrategy.WRAP);   // Vendor
  sh.getRange(2, 9, n, 1).setWrapStrategy(SpreadsheetApp.WrapStrategy.WRAP);   // Notes
  sh.getRange(2, 1, n, COLUMNS.length).setVerticalAlignment("middle").setFontSize(10);
}

/* Helper columns M (MonthKey), N (Income amount), O (Expense amount) power
   the Summary sheet's monthly table. They are formula-driven, so new rows
   and edits are always counted. */
function backfillHelpers_(sh) {
  var last = sh.getLastRow();
  if (last < 2) return;
  var formulas = [];
  for (var i = 2; i <= last; i++) {
    formulas.push([
      '=IF($H' + i + '="",,TEXT($H' + i + ',"YYYY-MM"))',
      '=IF($B' + i + '="Income",$D' + i + ',0)',
      '=IF($B' + i + '="Expense",$D' + i + ',0)'
    ]);
  }
  sh.getRange(2, 13, last - 1, 3).setFormulas(formulas);
}

/* Subtle whole-row tints so Income and Expense are easy to scan. */
function applyConditionalFormatting_(sh) {
  var last = Math.max(sh.getLastRow(), 2);
  var endRow = Math.max(last, 1000);
  var dataRange = sh.getRange(2, 1, endRow - 1, COLUMNS.length);

  var existing = sh.getConditionalFormatRules();
  var kept = existing.filter(function (rule) {
    var ranges = rule.getRanges();
    return !ranges.some(function (rg) {
      return rg.getRow() === 2 && rg.getColumn() === 1 && rg.getNumColumns() === COLUMNS.length;
    });
  });

  kept.push(
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=$B2="Income"')
      .setBackground("#E8F5EE")
      .setFontColor("#1E7A52")
      .setRanges([dataRange])
      .build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=$B2="Expense"')
      .setBackground("#FBF0ED")
      .setFontColor("#B4402E")
      .setRanges([dataRange])
      .build()
  );
  sh.setConditionalFormatRules(kept);
}

/* -------------------------- row write / delete ------------------------- */

function findRowByID_(sh, id) {
  var last = sh.getLastRow();
  if (last < 2) return -1;
  var ids = sh.getRange(2, 1, last - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(id)) return i + 2;
  }
  return -1;
}

function upsertRow_(sh, txn) {
  if (!txn || !txn.id) return null;
  var row = findRowByID_(sh, txn.id);
  var values = [
    String(txn.id),
    txn.type === "income" ? "Income" : "Expense",
    String(txn.title || ""),
    Number(txn.amount) || 0,
    String(txn.currency || "AED"),
    String(txn.category || ""),
    String(txn.vendor || ""),
    toDate_(txn.date),
    String(txn.notes || ""),
    toDate_(txn.createdAt),
    toDate_(txn.updatedAt),
    "Synced"
  ];
  var created = false;
  if (row === -1) {
    sh.appendRow(values);
    row = sh.getLastRow();
    created = true;
  } else {
    sh.getRange(row, 1, 1, values.length).setValues([values]);
  }
  formatRow_(sh, row);
  return { created: created, row: row };
}

function formatRow_(sh, row) {
  sh.getRange(row, 4, 1, 1).setNumberFormat(AMOUNT_FORMAT);
  sh.getRange(row, 8, 1, 1).setNumberFormat(DATE_FORMAT);
  sh.getRange(row, 10, 1, 1).setNumberFormat(DATETIME_FORMAT);
  sh.getRange(row, 11, 1, 1).setNumberFormat(DATETIME_FORMAT);
  sh.getRange(row, 3, 1, 1).setWrapStrategy(SpreadsheetApp.WrapStrategy.WRAP);
  sh.getRange(row, 7, 1, 1).setWrapStrategy(SpreadsheetApp.WrapStrategy.WRAP);
  sh.getRange(row, 9, 1, 1).setWrapStrategy(SpreadsheetApp.WrapStrategy.WRAP);
  sh.getRange(row, 1, 1, COLUMNS.length).setVerticalAlignment("middle").setFontSize(10);
  sh.getRange(row, 2, 1, 1).setHorizontalAlignment("center");
  sh.getRange(row, 5, 1, 1).setHorizontalAlignment("center");
  sh.getRange(row, 13, 1, 3).setFormulas([[
    '=IF($H' + row + '="",,TEXT($H' + row + ',"YYYY-MM"))',
    '=IF($B' + row + '="Income",$D' + row + ',0)',
    '=IF($B' + row + '="Expense",$D' + row + ',0)'
  ]]);
}

function deleteRow_(sh, id) {
  var row = findRowByID_(sh, id);
  if (row === -1) return { success: true, message: "No matching row to delete" };
  sh.deleteRow(row);
  return { success: true, message: "Transaction deleted successfully" };
}

function getAll_(sh) {
  var last = sh.getLastRow();
  if (last < 2) return { success: true, message: "", data: [] };
  var values = sh.getRange(2, 1, last - 1, 12).getValues();
  var headers = ["id","type","title","amount","currency","category","vendor","date","notes","createdAt","updatedAt","syncStatus"];
  var rows = values.map(function (r) {
    var obj = {};
    headers.forEach(function (h, i) { obj[h] = r[i]; });
    return obj;
  });
  return { success: true, message: "", data: rows };
}

/* ----------------------------- summary sheet --------------------------- */

function buildSummary_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var summary = ss.getSheetByName("Summary");
  if (!summary) {
    summary = ss.insertSheet("Summary");
    summary.setTabColor("#C9A227");
  }
  ensureSummary_(summary);
  formatSummary_(summary);
}

/* Only write cells that are still empty so a second run never duplicates
   sections or stomps on a value the user changed manually. */
function setCellIfEmpty_(sh, a1, value) {
  var existing = sh.getRange(a1).getValue();
  if (String(existing == null ? "" : existing).length === 0) {
    sh.getRange(a1).setValue(value);
  }
}

function ensureSummary_(summary) {
  setCellIfEmpty_(summary, "A1", "FINANCIAL SUMMARY");

  /* Overall */
  setCellIfEmpty_(summary, "A3", "OVERALL");
  setCellIfEmpty_(summary, "A4", "Total Income");
  setCellIfEmpty_(summary, "B4", '=SUMIF(Transactions!B:B,"Income",Transactions!D:D)');
  setCellIfEmpty_(summary, "A5", "Total Expenses");
  setCellIfEmpty_(summary, "B5", '=SUMIF(Transactions!B:B,"Expense",Transactions!D:D)');
  setCellIfEmpty_(summary, "A6", "Net Balance");
  setCellIfEmpty_(summary, "B6", "=B4-B5");

  /* Current month */
  setCellIfEmpty_(summary, "A8", "CURRENT MONTH");
  setCellIfEmpty_(summary, "A9", "Income This Month");
  setCellIfEmpty_(summary, "B9", '=SUMIFS(Transactions!D:D,Transactions!B:B,"Income",Transactions!H:H,">="&EOMONTH(TODAY(),-1)+1,Transactions!H:H,"<="&EOMONTH(TODAY(),0))');
  setCellIfEmpty_(summary, "A10", "Expenses This Month");
  setCellIfEmpty_(summary, "B10", '=SUMIFS(Transactions!D:D,Transactions!B:B,"Expense",Transactions!H:H,">="&EOMONTH(TODAY(),-1)+1,Transactions!H:H,"<="&EOMONTH(TODAY(),0))');
  setCellIfEmpty_(summary, "A11", "Net Balance This Month");
  setCellIfEmpty_(summary, "B11", "=B9-B10");

  /* Statistics */
  setCellIfEmpty_(summary, "A13", "STATISTICS");
  setCellIfEmpty_(summary, "A14", "Total Transactions");
  setCellIfEmpty_(summary, "B14", "=COUNTA(Transactions!A2:A)");
  setCellIfEmpty_(summary, "A15", "Income Transactions");
  setCellIfEmpty_(summary, "B15", '=COUNTIF(Transactions!B:B,"Income")');
  setCellIfEmpty_(summary, "A16", "Expense Transactions");
  setCellIfEmpty_(summary, "B16", '=COUNTIF(Transactions!B:B,"Expense")');
  setCellIfEmpty_(summary, "A17", "Average Expense");
  setCellIfEmpty_(summary, "B17", '=IFERROR(AVERAGEIF(Transactions!B:B,"Expense",Transactions!D:D),0)');
  setCellIfEmpty_(summary, "A18", "Largest Expense");
  setCellIfEmpty_(summary, "B18", '=IFERROR(MAXIFS(Transactions!D:D,Transactions!B:B,"Expense"),0)');
  setCellIfEmpty_(summary, "A19", "Largest Income");
  setCellIfEmpty_(summary, "B19", '=IFERROR(MAXIFS(Transactions!D:D,Transactions!B:B,"Income"),0)');

  /* Expenses by category (QUERY spills; new categories are picked up) */
  setCellIfEmpty_(summary, "D13", "EXPENSES BY CATEGORY");
  setCellIfEmpty_(summary, "D14", '=QUERY(Transactions!B2:F,"select Col5, sum(Col3) where Col1=""Expense"" group by Col5 order by sum(Col3) desc label sum(Col3) ""Total""",0)');

  /* Income by category */
  setCellIfEmpty_(summary, "G13", "INCOME BY CATEGORY");
  setCellIfEmpty_(summary, "G14", '=QUERY(Transactions!B2:F,"select Col5, sum(Col3) where Col1=""Income"" group by Col5 order by sum(Col3) desc label sum(Col3) ""Total""",0)');

  /* Monthly summary (helpers M/N/O on Transactions feed the SUMIFs) */
  setCellIfEmpty_(summary, "J13", "MONTHLY SUMMARY");
  setCellIfEmpty_(summary, "J14", "Month");
  setCellIfEmpty_(summary, "K14", "Income");
  setCellIfEmpty_(summary, "L14", "Expenses");
  setCellIfEmpty_(summary, "M14", "Net Balance");
  setCellIfEmpty_(summary, "P14", "MonthKey");
  setCellIfEmpty_(summary, "P15", '=SORT(UNIQUE(FILTER(Transactions!M2:M,Transactions!M2:M<>"")),1,FALSE)');
  setCellIfEmpty_(summary, "J15", '=ARRAYFORMULA(IF($P15:P="",,TEXT(DATE(VALUE(LEFT($P15:P,4)),VALUE(MID($P15:P,6,2)),1),"mmm yyyy")))');
  setCellIfEmpty_(summary, "K15", '=ARRAYFORMULA(IF($P15:P="",,SUMIF(Transactions!M2:M,$P15:P,Transactions!N2:N)))');
  setCellIfEmpty_(summary, "L15", '=ARRAYFORMULA(IF($P15:P="",,SUMIF(Transactions!M2:M,$P15:P,Transactions!O2:O)))');
  setCellIfEmpty_(summary, "M15", '=ARRAYFORMULA(IF($P15:P="",,$K15:K-$L15:L))');
}

function formatSummary_(summary) {
  summary.setColumnWidth(1, 240);
  summary.setColumnWidth(2, 170);
  summary.setColumnWidth(5, 200);
  summary.setColumnWidth(8, 200);
  summary.setColumnWidth(11, 160);
  summary.setColumnWidth(12, 160);
  summary.setColumnWidth(13, 160);
  summary.setColumnWidth(16, 110);

  summary.getRange("A1:B1").merge();
  summary.getRange("A1")
    .setBackground(HEADER_BG)
    .setFontColor("#FFFFFF")
    .setFontWeight("bold")
    .setFontSize(18)
    .setHorizontalAlignment("center")
    .setVerticalAlignment("middle");
  summary.setRowHeight(1, 42);

  var sections = ["A3", "A8", "A13", "D13", "G13", "J13"];
  for (var i = 0; i < sections.length; i++) {
    summary.getRange(sections[i])
      .setFontWeight("bold")
      .setFontSize(12)
      .setFontColor(HEADER_BG)
      .setBackground("#EEEAE0");
  }

  var currencyCells = ["B4", "B5", "B6", "B9", "B10", "B11", "B17", "B18", "B19"];
  for (var j = 0; j < currencyCells.length; j++) {
    summary.getRange(currencyCells[j]).setNumberFormat(SUMMARY_CURRENCY_FORMAT);
  }
  summary.getRange("B6").setFontWeight("bold");
  summary.getRange("B11").setFontWeight("bold");
  summary.getRange("A6").setFontWeight("bold");
  summary.getRange("A11").setFontWeight("bold");

  summary.getRange("B14").setNumberFormat("#,##0");
  summary.getRange("B15").setNumberFormat("#,##0");
  summary.getRange("B16").setNumberFormat("#,##0");

  summary.getRange("J14:M14")
    .setFontWeight("bold")
    .setBackground("#EEEAE0")
    .setHorizontalAlignment("center");
  summary.getRange("K15").setNumberFormat(SUMMARY_CURRENCY_FORMAT);
  summary.getRange("L15").setNumberFormat(SUMMARY_CURRENCY_FORMAT);
  summary.getRange("M15").setNumberFormat(SUMMARY_CURRENCY_FORMAT);
  summary.getRange("E14:E200").setNumberFormat(SUMMARY_CURRENCY_FORMAT);
  summary.getRange("H14:H200").setNumberFormat(SUMMARY_CURRENCY_FORMAT);
  summary.getRange("P14").setFontSize(8).setFontColor("#AAAAAA");
}
`;

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
