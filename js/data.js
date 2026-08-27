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
  amount: ["amount","value","total","price"],
  debit: ["debit","withdrawal","payment","out"],
  credit: ["credit","deposit","income","in"],
  currency: ["currency","curr","code"],
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

  function detectImportColumns(headerRow, sampleRows) {
    var idx = detectColumnIndices(headerRow);
    idx.currency = -1;
    idx.debit = -1;
    idx.credit = -1;

    if (!headerRow) return idx;

    var hasDebitCreditPattern = false;
    var hasCurrencyPattern = false;

    headerRow.forEach(function (h, i) {
      var low = String(h || "").trim().toLowerCase();
      if (idx.debit === -1 && KNOWN_HEADERS.debit.indexOf(low) !== -1) idx.debit = i;
      if (idx.credit === -1 && KNOWN_HEADERS.credit.indexOf(low) !== -1) idx.credit = i;
      if (idx.currency === -1 && KNOWN_HEADERS.currency.indexOf(low) !== -1) idx.currency = i;
    });

    if (idx.debit >= 0 && idx.credit >= 0 && idx.amount < 0) {
      hasDebitCreditPattern = true;
    }
    if (idx.currency >= 0 && idx.amount < 0) {
      hasCurrencyPattern = true;
    }

    if (hasDebitCreditPattern && idx.amount < 0) {
      idx.amount = -1;
    }

    var dateCols = [];
    headerRow.forEach(function (h, i) {
      var low = String(h || "").trim().toLowerCase();
      if (KNOWN_HEADERS.date.indexOf(low) !== -1) dateCols.push(i);
    });
    idx.date = dateCols.length > 0 ? dateCols[0] : -1;

    return idx;
  }

  function detectDateFormatPattern(dateStr) {
    if (!dateStr) return { format: "YYYY-MM-DD", ambiguous: false };
    var m = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/.exec(String(dateStr).trim());
    if (!m) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return { format: "YYYY-MM-DD", ambiguous: false };
      return { format: "unknown", ambiguous: false };
    }
    var first = Number(m[1]), second = Number(m[2]), yr = m[3];
    if (yr < 100) yr = "20" + yr;
    if (first > 12 && second <= 12) return { format: "DD/MM/YYYY", ambiguous: false };
    if (first <= 12 && second > 12) return { format: "MM/DD/YYYY", ambiguous: false };
    return { format: "ambiguous", ambiguous: true };
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
    if (!value && value !== 0) return null;
    var s = String(value).trim();
    if (s === "") return null;
    var currencyMatch = s.match(/([A-Z]{3})\s*([-+]?[\d,]+\.?\d*)/i);
    if (currencyMatch) {
      var currency = currencyMatch[1].toUpperCase();
      var amountStr = currencyMatch[2];
      var n = parseFloat(amountStr.replace(/,/g, ""));
      if (isFinite(n)) return Math.round(n * 100) / 100;
    }
    var n = parseFloat(s.replace(/[^0-9.\-]/g, ""));
    return isFinite(n) ? Math.round(n * 100) / 100 : null;
  }

  function normalizeImportType(value, defaultType) {
    if (!value) return defaultType || "expense";
    var low = String(value || "").trim().toLowerCase();
    if (["income","credit","in","+","deposit"].indexOf(low) !== -1) return "income";
    if (["expense","debit","out","-","payment","withdrawal"].indexOf(low) !== -1) return "expense";
    return defaultType || "expense";
  }

  function inferTransactionTypeFromAmounts(dateColIdx, amountColIdx, debitColIdx, creditColIdx, row) {
    if (debitColIdx >= 0 && creditColIdx >= 0) {
      var debitVal = normalizeImportAmount(row[debitColIdx]);
      var creditVal = normalizeImportAmount(row[creditColIdx]);
      if (debitVal && !creditVal) return "expense";
      if (creditVal && !debitVal) return "income";
      if (debitVal && creditVal) return debitVal > creditVal ? "expense" : "income";
    }
    var amountVal = normalizeImportAmount(row[amountColIdx]);
    if (amountVal === null) return null;
    if (amountVal < 0) return "expense";
    if (amountVal > 0) return "income";
    return null;
  }

  function categorizeTransaction(description, categoryHint, vendor) {
    if (!description) return categoryHint || "Other";
    var text = (categoryHint || "") + " " + (vendor || "") + " " + description;
    var expenseCat = matchCategory(text, EXPENSE_CATEGORY_KEYWORDS);
    var incomeCat = matchCategory(text, INCOME_CATEGORY_KEYWORDS);
    if (expenseCat && incomeCat) {
      var expLen = keywordLen(text, EXPENSE_CATEGORY_KEYWORDS[expenseCat]);
      var incLen = keywordLen(text, INCOME_CATEGORY_KEYWORDS[incomeCat]);
      return expLen >= incLen ? expenseCat : incomeCat;
    }
    return expenseCat || incomeCat || categoryHint || (description && "Other") || "Other";
  }

  var EXPENSE_CATEGORY_KEYWORDS = {
    "Food & Groceries": ["grocery", "groceries", "supermarket", "carrefour", "sugar", "food", "lunch", "dinner", "breakfast", "restaurant", "cafe", "coffee", "snacks", "starbucks", "kfc", "mcdonald"],
    "Transport": ["petrol", "fuel", "taxi", "uber", "careem", "metro", "bus", "parking", "car", "enoc", "adnoc"],
    "Shopping": ["clothes", "shoes", "amazon", "electronics", "phone", "laptop", "shirt", "t-shirt", "dress", "watch", "bag"],
    "Bills": ["electricity", "water", "internet", "wifi", "phone bill", "recharge", "dewa", "etisalat", "du", "utility", "bill"],
    "Entertainment": ["netflix", "cinema", "movie", "game", "spotify", "subscription", "concert", "entertainment"],
    "Health": ["doctor", "medicine", "pharmacy", "hospital", "gym", "dentist", "clinic"],
    "Education": ["course", "udemy", "books", "university", "school", "tuition", "coursera"],
    "Rent": ["rent", "apartment", "accommodation"],
    "Travel": ["flight", "hotel", "airbnb", "booking", "travel"]
  };

  var INCOME_CATEGORY_KEYWORDS = {
    "Salary": ["salary", "paycheck", "monthly salary", "wage", "payroll"],
    "Freelance": ["freelance", "client", "project payment", "upwork", "fiverr", "freelancing"],
    "Business": ["business", "customer payment", "sale", "profit", "sales"],
    "Investment": ["investment", "dividend", "stocks", "crypto", "interest", "shares"],
    "Rental Income": ["rent received", "tenant", "rental income"],
    "Gift": ["gift", "gifted"],
    "Refund": ["refund", "refunded"],
    "Other Income": []
  };

  function matchCategory(text, map) {
    if (!text) return null;
    var lower = " " + text.toLowerCase() + " ";
    var chosen = null, chosenLen = -1;
    Object.keys(map).forEach(function (cat) {
      (map[cat] || []).forEach(function (kw) {
        if (!kw) return;
        var re = kw.length <= 3 ? new RegExp("\\b" + escRe(kw) + "\\b") : new RegExp("\\b" + escRe(kw));
        if (!re.test(lower)) return;
        if (kw.length > chosenLen) {
          chosen = cat;
          chosenLen = kw.length;
        }
      });
    });
    return chosen;
  }

  function keywordLen(text, kws) {
    if (!text || !kws) return 0;
    var lower = text.toLowerCase();
    var len = -1;
    (kws || []).forEach(function (kw) {
      var idx = lower.indexOf(kw);
      if (idx !== -1 && kw.length > len) len = kw.length;
    });
    return len;
  }

  function escRe(str) {
    return String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

  function previewImport(candidates, existing) {
    var valid = [], invalid = [], duplicates = [];
    var acceptedFp = {};
    var byId = {};
    (existing || []).forEach(function (t) { if (t.id) byId[t.id] = true; acceptedFp[fingerprint(t)] = true; });
    candidates.forEach(function (c) {
      if (c.errors.length) { invalid.push(c); return; }
      if (c.skip || c.excluded) { duplicates.push(c); return; }
      var fp = fingerprint(c.data);
      if (acceptedFp[fp]) { duplicates.push(c); return; }
      /* Check against recently added fingerprints for same-day near-duplicates */
      var isDuplicate = false;
      var existingKeys = Object.keys(acceptedFp);
      existingKeys.forEach(function (existingFp) {
        if (isLikelyDuplicate(c.data, existingFp)) { isDuplicate = true; return; }
      });
      if (isDuplicate) { duplicates.push(c); return; }
      acceptedFp[fp] = true;
      valid.push(c);
    });
    return { valid: valid, invalid: invalid, duplicates: duplicates, total: candidates.length };
  }

  function isLikelyDuplicate(candidateData, existingFp) {
    var fpParts = existingFp.split("|");
    var fpDate = fpParts[0] || "", fpType = fpParts[1] || "", fpAmount = fpParts[2] || "", fpTitle = fpParts[3] || "", fpCategory = fpParts[4] || "";
    var nearDate = areDatesNearlyEqual(candidateData.date, fpDate);
    var similarDesc = areDescriptionsSimilar(candidateData.title, fpTitle);
    var sameType = candidateData.type === fpType;
    var sameAmt = String(Math.abs(candidateData.amount || 0)) === String(Math.abs(parseFloat(fpAmount) || 0));
    var sameCategory = candidateData.category && fpCategory && candidateData.category === fpCategory;

    var matchCount = (nearDate ? 1 : 0) + (similarDesc ? 1 : 0) + (sameType ? 1 : 0) + (sameAmt ? 1 : 0) + (sameCategory ? 1 : 0);
    return matchCount >= 3;
  }

  function areDatesNearlyEqual(date1, date2) {
    if (!date1 || !date2) return false;
    var d1 = new Date(date1), d2 = new Date(date2);
    var diff = Math.abs(d1 - d2);
    var daysDiff = diff / (1000 * 60 * 60 * 24);
    return daysDiff <= 7;
  }

  function areDescriptionsSimilar(desc1, desc2) {
    if (!desc1 || !desc2) return false;
    var d1 = (desc1 || "").toLowerCase().replace(/\s+/g, " ");
    var d2 = (desc2 || "").toLowerCase().replace(/\s+/g, " ");
    var tokens1 = new Set(d1.split(" "));
    var tokens2 = new Set(d2.split(" "));
    if (tokens1.size < 3 || tokens2.size < 3) return false;
    var common = 0;
    tokens1.forEach(function (t) { if (tokens2.has(t)) common++; });
    var similarity = common / Math.max(tokens1.size, tokens2.size);
    return similarity >= 0.5;
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
      var warnings = [];

      var rawDate = (mapping.date != null && mapping.date >= 0 && row[mapping.date] !== undefined) ? row[mapping.date] : "";
      var date = normalizeImportDate(rawDate);
      if (!date) errors.push("Invalid or missing date");

      var rawAmount = null;
      var amount = null;
      var inferredType = null;

      if (mapping.debit >= 0 || mapping.credit >= 0) {
        var debitCol = mapping.debit >= 0 ? normalizeImportAmount(row[mapping.debit]) : null;
        var creditCol = mapping.credit >= 0 ? normalizeImportAmount(row[mapping.credit]) : null;

        if (debitCol !== null && creditCol !== null) {
          amount = debitCol + creditCol;
          if (amount < 0) { amount = Math.abs(amount); inferredType = "expense"; }
          else if (amount > 0) inferredType = (debitCol > creditCol || creditCol === 0) ? "expense" : "income";
          else { amount = Math.max(Math.abs(debitCol), Math.abs(creditCol)); inferredType = "expense"; }
          if (debitCol > 0 && creditCol === 0) { amount = debitCol; inferredType = "expense"; }
          if (creditCol > 0 && debitCol === 0) { amount = creditCol; inferredType = "income"; }
        } else if (debitCol !== null) {
          amount = debitCol;
          if (amount < 0) { amount = Math.abs(amount); inferredType = "expense"; }
          else inferredType = "expense";
        } else if (creditCol !== null) {
          amount = creditCol;
          if (amount < 0) { amount = Math.abs(amount); inferredType = "income"; }
          else inferredType = "income";
        }
      } else if (mapping.amount >= 0) {
        rawAmount = (mapping.amount != null && mapping.amount >= 0 && row[mapping.amount] !== undefined) ? row[mapping.amount] : "";
        amount = normalizeImportAmount(rawAmount);
        if (amount === null) amount = null;
        if (amount !== null) {
          if (amount < 0) { inferredType = "expense"; amount = Math.abs(amount); }
          else inferredType = "income";
        }
      }

      if (amount == null) errors.push("Invalid or missing amount");

      var title = (mapping.title != null && mapping.title >= 0 && row[mapping.title] !== undefined) ? String(row[mapping.title] || "").trim() : "";
      if (!title && mapping.category != null && mapping.category >= 0 && row[mapping.category] !== undefined) title = String(row[mapping.category]).trim();
      if (!title && mapping.vendor != null && mapping.vendor >= 0 && row[mapping.vendor] !== undefined) title = String(row[mapping.vendor]).trim();
      if (!title && mapping.notes != null && mapping.notes >= 0 && row[mapping.notes] !== undefined) title = String(row[mapping.notes]).trim();
      if (!title) title = "Imported transaction";

      var type = null;
      if (mapping.type != null && mapping.type >= 0 && row[mapping.type] !== undefined) {
        type = normalizeImportType(row[mapping.type], defaultType);
      }
      if (!type && inferredType) type = inferredType;
      if (!type) type = defaultType || "expense";

      var category = "";
      if (mapping.category != null && mapping.category >= 0 && row[mapping.category] !== undefined) {
        category = String(row[mapping.category] || "").trim();
      }

      if (!category && !type.includes("income")) {
        category = categorizeTransaction(title + " " + (row[mapping.vendor] || ""), null, row[mapping.vendor] || "");
      } else if (!category) {
        category = "Other Income";
      }

      var vendor = "";
      if (mapping.vendor != null && mapping.vendor >= 0 && row[mapping.vendor] !== undefined) {
        vendor = String(row[mapping.vendor] || "").trim();
      } else {
        vendor = detectVendor(title);
      }

      var notes = "";
      if (mapping.notes != null && mapping.notes >= 0 && row[mapping.notes] !== undefined) {
        notes = String(row[mapping.notes] || "").trim();
      }

      var currency = ET.settings ? ET.settings.getCurrency() : "AED";
      if (mapping.currency >= 0 && row[mapping.currency] !== undefined) {
        var c = String(row[mapping.currency] || "").trim().toUpperCase();
        if (c.length === 3 || knownCurrency(c)) currency = c;
      }

      var detectedType = type;
      if (type === "expense" && amount < 0) {
        detectedType = "income";
        warnings.push("Negative amount treated as income");
      }

      var finalType = detectedType;
      var finalAmount = amount;
      if (finalAmount === null && rawAmount !== null) finalAmount = normalizeImportAmount(String(rawAmount).replace(/[^\-.\d]/g, ""));
      var finalCategory = category;
      if (!finalCategory || finalCategory === "Other") {
        finalCategory = categorizeTransaction(title, category, vendor);
      }

      candidates.push({
        data: { type: finalType, title: title, amount: finalAmount, category: finalCategory, vendor: vendor, date: date, notes: notes, currency: currency },
        errors: errors,
        warnings: warnings,
        rowIndex: idx + 1,
        skip: false
      });
    });

    return { candidates: candidates, total: total };
  }

  function knownCurrency(c) {
    var currencies = ["AED","USD","EUR","GBP","SAR","QAR","KWD","BHD","OMR","JOD","COP","CAD","AUD","CHF","INR","CNY"];
    return currencies.indexOf(c) !== -1;
  }

  function detectVendor(text) {
    if (!text) return "";
    var vendors = ["CARREFOUR","NETFLIX","AMAZON","UBER","CAREEM","STARBURSTS","ETIHAD","EMIRATES","DU","DEWA","ETISALAT","SHELL","ENOC","ADNOC","MATHAF","LULU","NAJIB","NOOR","AL FAHAIM","ALDAR"];
    var lower = text.toLowerCase();
    for (var i = 0; i < vendors.length; i++) {
      if (lower.indexOf(vendors[i].toLowerCase()) !== -1) return vendors[i];
    }
    return "";
  }

  function detectTypeFromAmount(amount) {
    if (amount === null || amount === undefined) return null;
    return Number(amount) < 0 ? "expense" : "income";
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
    detectImportColumns: detectImportColumns,
    inferTransactionTypeFromAmounts: inferTransactionTypeFromAmounts,
    categorizeTransaction: categorizeTransaction,
    detectVendor: detectVendor,
    knownCurrency: knownCurrency,
    detectTypeFromAmount: detectTypeFromAmount,
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