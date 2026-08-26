/* =========================================================================
   data.js — export, backup, import and data management (Part 8)
   Pure functions for CSV/JSON export, full backup/restore/merge, CSV/JSON
   import with validation, deduplication, and safe data clearing.
   All operations work through ET.transactions, ET.budgets, ET.recurring and
   ET.storage — never touching localStorage directly.

   Attaches to: window.ET.data
   ========================================================================= */
(function (global) {
  "use strict";

  var ET = (global.ET = global.ET || {});
  var storage = ET.storage;

  var APP_NAME = "Expense Tracker";
  var BACKUP_VERSION = "1.0";

  /* CSV column names for auto-detection */
  var KNOWN_HEADERS = {
    date: ["date","transaction date","transdate","posting date","posteddate"],
    title: ["title","description","name","item","narration","payee","merchant"],
    amount: ["amount","value","total","price","debit","credit"],
    type: ["type","transaction type","category type","txntype","kind"],
    category: ["category","category name","cat","expense type"],
    vendor: ["vendor","merchant","store","source","payee","supplier"],
    notes: ["notes","note","memo","comment","description2"]
  };

  /* --------------------------- CSV helpers ------------------------------ */

  function csvEscape(value) {
    var s = String(value == null ? "" : value);
    if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function toCSV(rows) {
    return rows.map(function (r) { return r.map(csvEscape).join(","); }).join("\r\n");
  }

  function parseCSV(text) {
    var s = String(text || "").replace(/^\uFEFF/, "").trim();
    if (!s) return [];
    var rows = [], row = [], field = "", inQ = false, i = 0;
    while (i < s.length) {
      var c = s[i];
      if (inQ) {
        if (c === '"') {
          if (s[i + 1] === '"') { field += '"'; i += 2; continue; }
          inQ = false; i++; continue;
        }
        field += c; i++; continue;
      }
      if (c === '"') { inQ = true; i++; continue; }
      if (c === ",") { row.push(field); field = ""; i++; continue; }
      if (c === "\n" || c === "\r") {
        if (c === "\r" && s[i + 1] === "\n") i++;
        row.push(field); field = "";
        if (row.length > 1 || row[0] !== "") rows.push(row);
        row = []; i++; continue;
      }
      field += c; i++;
    }
    if (field !== "" || row.length) { row.push(field); }
    if (row.length > 1 || (row.length === 1 && row[0] !== "")) rows.push(row);
    return rows;
  }

  /* --------------------------- column detection ------------------------- */

  function detectColumnIndices(headerRow) {
    var idx = { date: -1, title: -1, amount: -1, type: -1, category: -1, vendor: -1, notes: -1 };
    if (!headerRow) return idx;
    headerRow.forEach(function (h, i) {
      var low = String(h || "").trim().toLowerCase();
      Object.keys(KNOWN_HEADERS).forEach(function (key) {
        if (KNOWN_HEADERS[key].indexOf(low) !== -1) idx[key] = i;
      });
    });
    return idx;
  }

  /* --------------------------- date normalization ----------------------- */

  function normalizeImportDate(value) {
    if (!value) return null;
    var s = String(value).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      var d = new Date(Number(s.slice(0,4)), Number(s.slice(5,7)) - 1, Number(s.slice(8,10)));
      if (!isNaN(d.getTime()) && d.getFullYear() === Number(s.slice(0,4)) && d.getMonth() === Number(s.slice(5,7)) - 1 && d.getDate() === Number(s.slice(8,10))) return s;
    }
    var m = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/.exec(s);
    if (m) {
      var day = Number(m[1]), mon = Number(m[2]), yr = Number(m[3]);
      if (yr < 100) yr += 2000;
      if (mon > 12 && day <= 12) { var tmp = day; day = mon; mon = tmp; }
      if (mon < 1 || mon > 12 || day < 1 || day > 31) return null;
      var d2 = new Date(yr, mon - 1, day);
      if (!isNaN(d2.getTime()) && d2.getFullYear() === yr && d2.getMonth() === mon - 1 && d2.getDate() === day) {
        return yr + "-" + String(mon).padStart(2, "0") + "-" + String(day).padStart(2, "0");
      }
    }
    return null;
  }

  function normalizeImportAmount(value) {
    var n = parseFloat(String(value || "").replace(/[^0-9.\-]/g, ""));
    return isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
  }

  function normalizeImportType(value, defaultType) {
    var low = String(value || "").trim().toLowerCase();
    if (["income","credit","in","+"].indexOf(low) !== -1) return "income";
    if (["expense","debit","out","-"].indexOf(low) !== -1) return "expense";
    return defaultType || "expense";
  }

  /* --------------------------- transaction rows ------------------------- */

  var EXPORT_HEADERS = ["ID","Date","Type","Title","Category","Amount","Currency","Vendor/Source","Notes","Recurring ID","Created At","Updated At"];

  function transactionToRow(t) {
    return [
      t.id || "",
      t.date || "",
      t.type === "income" ? "Income" : "Expense",
      t.title || "",
      t.category || "",
      t.amount != null ? t.amount : "",
      t.currency || "AED",
      t.vendor || "",
      t.notes || "",
      t.recurringId || "",
      t.createdAt != null ? new Date(t.createdAt).toISOString() : "",
      t.updatedAt != null ? new Date(t.updatedAt).toISOString() : ""
    ];
  }

  function exportTransactionsCSV(list) {
    var rows = [EXPORT_HEADERS].concat(list.map(transactionToRow));
    return toCSV(rows);
  }

  function exportTransactionsJSON(list) {
    return JSON.stringify(list, null, 2);
  }

  function exportFinancialSummaryCSV(list) {
    var data = ET.reports ? ET.reports.allReports(list) : null;
    if (!data) return "No report data available.";
    var currency = ET.settings ? ET.settings.getCurrency() : "AED";
    var lines = [];
    lines.push(csvEscape("Financial Summary"));
    lines.push("Label,Value");
    lines.push(csvEscape("Period") + "," + csvEscape("Custom range"));
    lines.push(csvEscape("Total Income") + "," + csvEscape(currency + " " + data.overview.totalIncome.toFixed(2)));
    lines.push(csvEscape("Total Expenses") + "," + csvEscape(currency + " " + data.overview.totalExpenses.toFixed(2)));
    lines.push(csvEscape("Net Balance") + "," + csvEscape(currency + " " + data.overview.balance.toFixed(2)));
    if (data.overview.savingsRate != null) lines.push(csvEscape("Savings Rate") + "," + csvEscape(data.overview.savingsRate.toFixed(1) + "%"));
    lines.push("");
    lines.push(csvEscape("Top Expense Categories"));
    lines.push("Category,Amount,Percentage");
    (data.expenseCategory.rows || []).forEach(function (r) {
      lines.push(csvEscape(r.category) + "," + csvEscape(String(r.amount)) + "," + csvEscape(r.pct.toFixed(1) + "%"));
    });
    lines.push("");
    lines.push(csvEscape("Top Income Categories"));
    lines.push("Category,Amount,Percentage");
    (data.incomeCategory.rows || []).forEach(function (r) {
      lines.push(csvEscape(r.category) + "," + csvEscape(String(r.amount)) + "," + csvEscape(r.pct.toFixed(1) + "%"));
    });
    return lines.join("\r\n");
  }

  /* --------------------------- fingerprint ------------------------------ */

  function fingerprint(t) {
    return [
      (t.date || ""),
      (t.type || "").toLowerCase(),
      String(Number(t.amount) || 0),
      String(t.title || "").trim().toLowerCase(),
      (t.category || "").trim().toLowerCase()
    ].join("|");
  }

  function detectDuplicates(incoming, existing) {
    var byId = {}, byFp = {};
    existing.forEach(function (t) { if (t.id) byId[t.id] = true; byFp[fingerprint(t)] = true; });
    var result = { new: [], duplicates: [], invalid: [] };
    var acceptedFp = {};
    incoming.forEach(function (t, idx) {
      if (!t || !t.id || !t.date) { result.invalid.push({ row: idx + 1, reason: "ID or date missing" }); return; }
      if (byId[t.id]) { result.duplicates.push({ row: idx + 1, reason: "ID already exists" }); return; }
      var fp = fingerprint(t);
      if (byFp[fp] || acceptedFp[fp]) { result.duplicates.push({ row: idx + 1, reason: "Same transaction already exists" }); return; }
      acceptedFp[fp] = true;
      result.new.push(t);
    });
    return result;
  }

  /* --------------------------- CSV import rows -------------------------- */

  function buildImportedRows(rows, mapping, defaultType) {
    var candidates = [];
    var total = 0;
    rows.forEach(function (row, idx) {
      total++;
      var errors = [];
      var date = mapping.date != null && mapping.date >= 0 ? normalizeImportDate(row[mapping.date]) : null;
      if (!date) errors.push("Invalid or missing date");
      var amount = mapping.amount != null && mapping.amount >= 0 ? normalizeImportAmount(row[mapping.amount]) : null;
      if (amount == null) errors.push("Invalid or missing amount");
      var title = (mapping.title != null && mapping.title >= 0) ? String(row[mapping.title] || "").trim() : "";
      if (!title && mapping.category != null && mapping.category >= 0 && row[mapping.category]) title = String(row[mapping.category]).trim();
      if (!title) title = "Imported transaction";
      var type = (mapping.type != null && mapping.type >= 0) ? normalizeImportType(row[mapping.type], defaultType) : defaultType || "expense";
      var category = (mapping.category != null && mapping.category >= 0) ? String(row[mapping.category] || "").trim() : "";
      var vendor = (mapping.vendor != null && mapping.vendor >= 0) ? String(row[mapping.vendor] || "").trim() : "";
      var notes = (mapping.notes != null && mapping.notes >= 0) ? String(row[mapping.notes] || "").trim() : "";
      candidates.push({
        data: { type: type, title: title, amount: amount, category: category, vendor: vendor, date: date, notes: notes },
        errors: errors,
        rowIndex: idx + 1
      });
    });
    return { candidates: candidates, total: total };
  }

  /* Build candidates from JSON array of objects. */
  function buildImportedRowsFromObjects(objects, defaultType) {
    var candidates = [];
    var total = 0;
    objects.forEach(function (obj, idx) {
      if (!obj || typeof obj !== "object") { candidates.push({ data: null, errors: ["Invalid row"], rowIndex: idx + 1 }); total++; return; }
      total++;
      var errors = [];
      var date = normalizeImportDate(obj.date);
      if (!date) errors.push("Invalid or missing date");
      var amount = normalizeImportAmount(obj.amount);
      if (amount == null) errors.push("Invalid or missing amount");
      var title = obj.title ? String(obj.title).trim() : (obj.category || "Imported transaction");
      var type = normalizeImportType(obj.type, defaultType);
      var category = obj.category ? String(obj.category).trim() : "";
      var vendor = obj.vendor ? String(obj.vendor).trim() : "";
      var notes = obj.notes ? String(obj.notes).trim() : "";
      candidates.push({
        data: { type: type, title: title, amount: amount, category: category, vendor: vendor, date: date, notes: notes },
        errors: errors,
        rowIndex: idx + 1
      });
    });
    return { candidates: candidates, total: total };
  }

  function previewImport(candidates, existing) {
    var valid = [], invalid = [], duplicates = [];
    var acceptedFp = {};
    var byId = {};
    (existing || []).forEach(function (t) { if (t.id) byId[t.id] = true; acceptedFp[fingerprint(t)] = true; });
    candidates.forEach(function (c) {
      if (c.errors.length) { invalid.push(c); return; }
      var fp = fingerprint(c.data);
      if (acceptedFp[fp]) { duplicates.push(c); return; }
      acceptedFp[fp] = true;
      valid.push(c);
    });
    return { valid: valid, invalid: invalid, duplicates: duplicates, total: candidates.length };
  }

  async function importValidRows(preview) {
    var imported = 0;
    for (var i = 0; i < (preview.valid || []).length; i++) {
      var c = preview.valid[i];
      var rec = ET.transactions ? await ET.transactions.addTransaction(c.data) : null;
      if (rec) imported++;
    }
    return { imported: imported, skippedDuplicates: (preview.duplicates || []).length, skippedInvalid: (preview.invalid || []).length };
  }

  /* --------------------------- full backup ------------------------------ */

  function createFullBackup() {
    var budgets = ET.budgets ? ET.budgets.getBudgetsConfig() : {};
    var goals = ET.budgets ? ET.budgets.getGoals() : [];
    var recurring = ET.recurring ? ET.recurring.getRecurring() : [];
    var transactions = ET.transactions ? ET.transactions.all() : [];
    var backup = {
      appName: APP_NAME,
      version: BACKUP_VERSION,
      exportedAt: new Date().toISOString(),
      data: {
        transactions: transactions,
        budgets: budgets,
        financialGoals: goals,
        recurringTransactions: recurring,
        settings: {}
      }
    };
    if (ET.storage) ET.storage.saveBackupMeta({ lastBackupAt: Date.now() });
    return backup;
  }

  function validateBackup(obj) {
    if (!obj || typeof obj !== "object") return { valid: false, reason: "Not a valid JSON backup file." };
    if (!obj.data || typeof obj.data !== "object") return { valid: false, reason: "Backup is missing its data section." };
    return { valid: true, version: obj.version || "unknown", exportedAt: obj.exportedAt || null };
  }

  function previewBackup(obj) {
    var data = obj.data || {};
    var goals = Array.isArray(data.financialGoals) ? data.financialGoals : [];
    var contributions = 0;
    goals.forEach(function (g) { contributions += (g.contributions || []).length; });
    return {
      transactions: Array.isArray(data.transactions) ? data.transactions.length : 0,
      budgets: (data.budgets && data.budgets.monthly > 0 ? 1 : 0) + (data.budgets && data.budgets.categories ? Object.keys(data.budgets.categories).length : 0),
      financialGoals: goals.length,
      goalContributions: contributions,
      recurringTransactions: Array.isArray(data.recurringTransactions) ? data.recurringTransactions.length : 0,
      exportedAt: obj.exportedAt || null,
      version: obj.version || "unknown"
    };
  }

  function restoreBackup(obj) {
    var data = obj.data || {};
    var tx = Array.isArray(data.transactions) ? data.transactions : [];
    storage.replaceAllTransactions(tx);
    if (data.budgets && ET.budgets) {
      ET.budgets.saveBudgetsConfig({ monthly: data.budgets.monthly || 0, categories: data.budgets.categories || {} });
    }
    if (ET.budgets) ET.storage.saveGoals(Array.isArray(data.financialGoals) ? data.financialGoals : []);
    if (ET.recurring) ET.storage.saveRecurring(Array.isArray(data.recurringTransactions) ? data.recurringTransactions : []);
    return { transactions: tx.length, status: "restored" };
  }

  function mergeBackup(obj, existing) {
    var data = obj.data || {};
    var incomingTx = Array.isArray(data.transactions) ? data.transactions : [];
    var dedup = detectDuplicates(incomingTx, existing || []);
    var imported = 0;
    dedup.new.forEach(function (rec) {
      if (ET.transactions) ET.transactions.importRecord(rec);
      imported++;
    });
    /* Merge goals: add new ones, skip existing IDs */
    var incomingGoals = Array.isArray(data.financialGoals) ? data.financialGoals : [];
    var existingGoals = ET.budgets ? ET.budgets.getGoals() : [];
    var existingGoalIds = {};
    existingGoals.forEach(function (g) { existingGoalIds[g.id] = true; });
    incomingGoals.forEach(function (g) {
      if (g.id && !existingGoalIds[g.id] && ET.budgets) {
        var list = ET.budgets.getGoals();
        list.push(g);
        ET.storage.saveGoals(list);
        existingGoalIds[g.id] = true;
      }
    });
    /* Merge recurring: add new ones */
    var incomingRec = Array.isArray(data.recurringTransactions) ? data.recurringTransactions : [];
    var existingRec = ET.recurring ? ET.recurring.getRecurring() : [];
    var existingRecIds = {};
    existingRec.forEach(function (r) { existingRecIds[r.id] = true; });
    incomingRec.forEach(function (r) {
      if (r.id && !existingRecIds[r.id] && ET.recurring) {
        var list = ET.recurring.getRecurring();
        list.push(r);
        ET.storage.saveRecurring(list);
        existingRecIds[r.id] = true;
      }
    });
    return { imported: imported, skippedDuplicates: dedup.duplicates.length, skippedInvalid: dedup.invalid.length, goalsImported: incomingGoals.length - dedup.duplicates.length, recurringImported: incomingRec.length - existingRec.length };
  }

  /* --------------------------- filter helpers --------------------------- */

  function filterForExport(all, filters) {
    var list = all;
    if (filters.range !== "all") list = (ET.reports ? ET.reports.filterByDateRange(list, filters.range, filters.start, filters.end) : list);
    list = (ET.reports ? ET.reports.filterByType(list, filters.type) : list);
    list = (ET.reports ? ET.reports.filterByCategory(list, filters.category) : list);
    return list;
  }

  /* --------------------------- storage overview ------------------------- */

  function storageOverview() {
    var tx = ET.transactions ? ET.transactions.all() : [];
    var goals = ET.budgets ? ET.budgets.getGoals() : [];
    var contributions = 0;
    goals.forEach(function (g) { contributions += (g.contributions || []).length; });
    var recurring = ET.recurring ? ET.recurring.getRecurring() : [];
    var meta = ET.storage ? ET.storage.getBackupMeta() : null;
    var lastBackupAt = meta ? meta.lastBackupAt : null;
    var size = 0;
    try {
      var allKeys = {};
      (ET.storage ? ET.storage.APP_KEYS || [] : []).forEach(function (k) {
        var v = global.localStorage ? global.localStorage.getItem(k) : null;
        if (v) allKeys[k] = v.length;
      });
      size = Object.keys(allKeys).reduce(function (s, k) { return s + allKeys[k]; }, 0);
    } catch (e) { /* ignore */ }
    return {
      transactions: tx.length,
      recurring: recurring.length,
      goals: goals.length,
      contributions: contributions,
      sizeBytes: size,
      lastBackupAt: lastBackupAt
    };
  }

  /* --------------------------- clear / reset ---------------------------- */

  function clearTransactions() {
    return ET.storage ? ET.storage.clearTransactions() : false;
  }

  function clearTestData() {
    return ET.storage ? ET.storage.clearTestData() : false;
  }

  function resetApplication() {
    return ET.storage ? ET.storage.resetAll() : false;
  }

  /* ------------------------------ public API ---------------------------- */

  ET.data = {
    EXPORT_HEADERS: EXPORT_HEADERS,
    KNOWN_HEADERS: KNOWN_HEADERS,
    csvEscape: csvEscape, toCSV: toCSV, parseCSV: parseCSV,
    detectColumnIndices: detectColumnIndices,
    transactionToRow: transactionToRow,
    exportTransactionsCSV: exportTransactionsCSV,
    exportTransactionsJSON: exportTransactionsJSON,
    exportFinancialSummaryCSV: exportFinancialSummaryCSV,
    fingerprint: fingerprint,
    detectDuplicates: detectDuplicates,
    buildImportedRows: buildImportedRows,
    buildImportedRowsFromObjects: buildImportedRowsFromObjects,
    previewImport: previewImport,
    importValidRows: importValidRows,
    createFullBackup: createFullBackup,
    validateBackup: validateBackup,
    previewBackup: previewBackup,
    restoreBackup: restoreBackup,
    mergeBackup: mergeBackup,
    filterForExport: filterForExport,
    storageOverview: storageOverview,
    clearTransactions: clearTransactions,
    clearTestData: clearTestData,
    resetApplication: resetApplication
  };
})(window);