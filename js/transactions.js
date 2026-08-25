/* =========================================================================
   transactions.js — domain logic
   CRUD orchestration on top of ET.storage, plus the pure calculations the
   dashboard and list rely on (totals, filtering, sorting, breakdowns).
   Kept free of DOM code so it can be reused/tested independently.

   The single write path is addTransaction() — the manual form uses it,
   and a future natural-language parser can call the same function.

   Attaches to: window.ET.transactions  (and window.ET.expenses as alias)
   ========================================================================= */
(function (global) {
  "use strict";

  var ET = (global.ET = global.ET || {});
  var storage = ET.storage;

  /* ---------- date helpers (local time, not UTC) ---------- */
  function todayKey() {
    var d = new Date();
    return ymd(d);
  }
  function ymd(d) {
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, "0");
    var day = String(d.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + day;
  }
  function monthKeyOf(dateStr) {
    return (dateStr || "").slice(0, 7);
  }
  function currentMonthKey() {
    var d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
  }

  function roundMoney(n) {
    if (!isFinite(n)) return 0;
    return Math.round(n * 100) / 100;
  }

  function recordType(record) {
    return storage.normalizeType(record && record.type);
  }

  /* ---------- normalisation ---------- */
  function normalizeInput(input) {
    input = input || {};
    return {
      type: storage.normalizeType(input.type),
      title: String(input.title == null ? "" : input.title).trim(),
      amount: roundMoney(Number(input.amount)),
      currency: storage.DEFAULT_CURRENCY,
      category: String(input.category == null ? "" : input.category).trim(),
      vendor: String(input.vendor == null ? "" : input.vendor).trim(),
      date: String(input.date == null ? "" : input.date).trim(),
      notes: String(input.notes == null ? "" : input.notes).trim()
    };
  }

  function buildRecord(clean, id, createdAt, updatedAt) {
    return {
      id: id,
      type: clean.type,
      title: clean.title,
      amount: clean.amount,
      currency: clean.currency,
      category: clean.category,
      vendor: clean.vendor,
      date: clean.date,
      notes: clean.notes,
      createdAt: createdAt,
      updatedAt: updatedAt,
      /* Part 4: Google Sheets sync state. Fresh records need syncing. */
      syncStatus: "pending"
    };
  }

  var transactions = {
    /* ---------------- reads ---------------- */
    all: function () {
      return storage.getAll();
    },

    /* Newest first: by date desc, tie-broken by createdAt desc. */
    sortNewestFirst: function (list) {
      return list.slice().sort(function (a, b) {
        if (a.date !== b.date) return a.date < b.date ? 1 : -1;
        return (b.createdAt || 0) - (a.createdAt || 0);
      });
    },

    /*
     * Apply filters (all optional, combined with AND):
     *   opts.search   -> matches title OR vendor (case-insensitive substring)
     *   opts.category -> exact category match
     *   opts.month    -> "YYYY-MM" match on the transaction date
     *   opts.type     -> "income" | "expense" | "all"/""
     */
    filter: function (list, opts) {
      opts = opts || {};
      var q = (opts.search || "").trim().toLowerCase();
      var cat = opts.category || "";
      var month = opts.month || "";
      var type = opts.type || "";
      if (type === "all") type = "";

      return list.filter(function (e) {
        if (type && recordType(e) !== type) return false;
        if (q) {
          var title = (e.title || "").toLowerCase();
          var vendor = (e.vendor || "").toLowerCase();
          if (title.indexOf(q) === -1 && vendor.indexOf(q) === -1) return false;
        }
        if (cat && e.category !== cat) return false;
        if (month && monthKeyOf(e.date) !== month) return false;
        return true;
      });
    },

    /* Distinct months present in the data, newest first: [{key,label}]. */
    availableMonths: function (list) {
      var seen = {};
      list.forEach(function (e) {
        var k = monthKeyOf(e.date);
        if (k) seen[k] = true;
      });
      return Object.keys(seen)
        .sort()
        .reverse()
        .map(function (k) {
          return { key: k, label: monthLabel(k) };
        });
    },

    /* ---------------- writes ---------------- */
    /**
     * Central create path. Manual form and (later) NL parsing both call this.
     * addTransaction({ type, title, amount, category, vendor, date, notes })
     */
    addTransaction: function (input) {
      var clean = normalizeInput(input);
      var now = Date.now();
      var record = buildRecord(clean, storage.newId(), now, now);
      storage.add(record);
      return record;
    },

    create: function (input) {
      return this.addTransaction(input);
    },

    update: function (id, input) {
      var existing = storage.get(id);
      var clean = normalizeInput(input);
      var now = Date.now();
      var createdAt = existing && existing.createdAt != null ? existing.createdAt : now;
      var record = buildRecord(clean, id, createdAt, now);
      return storage.update(id, record);
    },

    updateTransaction: function (id, input) {
      return this.update(id, input);
    },

    remove: function (id) {
      return storage.remove(id);
    },

    removeTransaction: function (id) {
      return this.remove(id);
    },

    get: function (id) {
      return storage.get(id);
    },

    loadSamples: function () {
      return storage.loadSampleData();
    },

    /* ---------------- validation ---------------- */
    validate: function (input) {
      var errors = {};
      var type = storage.normalizeType(input && input.type);
      var title = ((input && input.title) || "").trim();
      var amountNum = Number(input && input.amount);
      var category = ((input && input.category) || "").trim();
      var date = ((input && input.date) || "").trim();
      var allowed = storage.categoriesFor(type);

      if (!title) {
        errors.title = type === "income"
          ? "Give the income a name."
          : "Give the expense a name.";
      }

      if (!input || input.amount === "" || input.amount == null) {
        errors.amount = "Enter an amount.";
      } else if (isNaN(amountNum)) {
        errors.amount = "Amount must be a number.";
      } else if (amountNum <= 0) {
        errors.amount = "Amount must be greater than 0.";
      }

      if (!category) errors.category = "Pick a category.";
      if (category && allowed.indexOf(category) === -1) {
        errors.category = "Pick a valid category for this type.";
      }

      if (!date) errors.date = "Choose a date.";

      return errors;
    },

    /* ---------------- statistics ---------------- */
    stats: function (list) {
      var monthKey = currentMonthKey();
      var today = todayKey();

      var totalIncome = 0;
      var totalExpenses = 0;
      var monthIncome = 0;
      var monthExpenses = 0;
      var todaySpending = 0;
      var todayCount = 0;
      var incomeCount = 0;
      var expenseCount = 0;
      var monthIncomeCount = 0;
      var monthExpenseCount = 0;

      list.forEach(function (e) {
        var amt = Number(e.amount) || 0;
        var type = recordType(e);
        var inMonth = monthKeyOf(e.date) === monthKey;

        if (type === "income") {
          totalIncome += amt;
          incomeCount += 1;
          if (inMonth) {
            monthIncome += amt;
            monthIncomeCount += 1;
          }
        } else {
          totalExpenses += amt;
          expenseCount += 1;
          if (inMonth) {
            monthExpenses += amt;
            monthExpenseCount += 1;
          }
          if (e.date === today) {
            todaySpending += amt;
            todayCount += 1;
          }
        }
      });

      return {
        totalIncome: roundMoney(totalIncome),
        totalExpenses: roundMoney(totalExpenses),
        totalBalance: roundMoney(totalIncome - totalExpenses),
        monthIncome: roundMoney(monthIncome),
        monthExpenses: roundMoney(monthExpenses),
        monthBalance: roundMoney(monthIncome - monthExpenses),
        todaySpending: roundMoney(todaySpending),
        todayCount: todayCount,
        totalCount: list.length,
        incomeCount: incomeCount,
        expenseCount: expenseCount,
        monthIncomeCount: monthIncomeCount,
        monthExpenseCount: monthExpenseCount,
        monthKey: monthKey,
        monthLabel: monthLabel(monthKey)
      };
    },

    /*
     * Spending grouped by category for the current month, sorted high→low.
     * Income is excluded — this is an expense breakdown.
     */
    spendingByCategory: function (list) {
      var monthKey = currentMonthKey();
      var totals = {};
      var grand = 0;
      list.forEach(function (e) {
        if (recordType(e) !== "expense") return;
        if (monthKeyOf(e.date) !== monthKey) return;
        var amt = Number(e.amount) || 0;
        totals[e.category] = (totals[e.category] || 0) + amt;
        grand += amt;
      });
      return Object.keys(totals)
        .map(function (cat) {
          return {
            category: cat,
            amount: roundMoney(totals[cat]),
            pct: grand > 0 ? (totals[cat] / grand) * 100 : 0
          };
        })
        .sort(function (a, b) { return b.amount - a.amount; });
    },

    filteredTotals: function (list) {
      var income = 0;
      var expenses = 0;
      list.forEach(function (e) {
        var amt = Number(e.amount) || 0;
        if (recordType(e) === "income") income += amt;
        else expenses += amt;
      });
      return {
        income: roundMoney(income),
        expenses: roundMoney(expenses),
        net: roundMoney(income - expenses)
      };
    },

    _util: {
      todayKey: todayKey,
      ymd: ymd,
      monthKeyOf: monthKeyOf,
      currentMonthKey: currentMonthKey,
      monthLabel: monthLabel,
      recordType: recordType
    }
  };

  function monthLabel(key) {
    if (!key || key.length < 7) return key || "";
    var parts = key.split("-");
    var year = Number(parts[0]);
    var monthIdx = Number(parts[1]) - 1;
    var names = ["January","February","March","April","May","June","July","August","September","October","November","December"];
    if (monthIdx < 0 || monthIdx > 11) return key;
    return names[monthIdx] + " " + year;
  }

  ET.transactions = transactions;
  /* Backward-compatible alias used by existing UI/app files. */
  ET.expenses = transactions;
})(window);
