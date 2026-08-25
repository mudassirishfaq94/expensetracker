/* =========================================================================
   expenses.js — domain logic
   CRUD orchestration on top of ET.storage, plus the pure calculations the
   dashboard and list rely on (totals, filtering, sorting, breakdowns).
   Kept free of DOM code so it can be reused/tested independently.

   Attaches to: window.ET.expenses
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
    // dateStr is "YYYY-MM-DD"; the first 7 chars are "YYYY-MM"
    return (dateStr || "").slice(0, 7);
  }
  function currentMonthKey() {
    var d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
  }

  /* ---------- normalisation ---------- */
  /* Coerce a raw form payload into a clean, storable record. */
  function normalizeInput(input) {
    return {
      title: String(input.title == null ? "" : input.title).trim(),
      amount: roundMoney(Number(input.amount)),
      currency: storage.DEFAULT_CURRENCY,
      category: String(input.category == null ? "" : input.category).trim(),
      vendor: String(input.vendor == null ? "" : input.vendor).trim(),
      date: String(input.date == null ? "" : input.date).trim(),
      notes: String(input.notes == null ? "" : input.notes).trim()
    };
  }

  function roundMoney(n) {
    if (!isFinite(n)) return 0;
    return Math.round(n * 100) / 100;
  }

  var expenses = {
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
     * Apply the three filters (all optional, combined with AND):
     *   opts.search   -> matches title OR vendor (case-insensitive substring)
     *   opts.category -> exact category match
     *   opts.month    -> "YYYY-MM" match on the expense date
     */
    filter: function (list, opts) {
      opts = opts || {};
      var q = (opts.search || "").trim().toLowerCase();
      var cat = opts.category || "";
      var month = opts.month || "";

      return list.filter(function (e) {
        if (q) {
          var hay = ((e.title || "") + " " + (e.vendor || "")).toLowerCase();
          if (hay.indexOf(q) === -1) return false;
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
    create: function (input) {
      var clean = normalizeInput(input);
      var now = Date.now();
      var record = {
        id: storage.newId(),
        title: clean.title,
        amount: clean.amount,
        currency: clean.currency,
        category: clean.category,
        vendor: clean.vendor,
        date: clean.date,
        notes: clean.notes,
        createdAt: now,
        updatedAt: now
      };
      storage.add(record);
      return record;
    },

    update: function (id, input) {
      var clean = normalizeInput(input);
      clean.updatedAt = Date.now();
      return storage.update(id, clean);
    },

    remove: function (id) {
      return storage.remove(id);
    },

    get: function (id) {
      return storage.get(id);
    },

    loadSamples: function () {
      return storage.loadSampleData();
    },

    /* ---------------- validation ---------------- */
    /* Returns a map of { field: message }. Empty map means valid. */
    validate: function (input) {
      var errors = {};
      var title = (input.title || "").trim();
      var amountNum = Number(input.amount);
      var category = (input.category || "").trim();
      var date = (input.date || "").trim();

      if (!title) errors.title = "Give the expense a name.";

      if (input.amount === "" || input.amount == null) {
        errors.amount = "Enter an amount.";
      } else if (isNaN(amountNum)) {
        errors.amount = "Amount must be a number.";
      } else if (amountNum <= 0) {
        errors.amount = "Amount must be greater than 0.";
      }

      if (!category) errors.category = "Pick a category.";
      if (storage.CATEGORIES.indexOf(category) === -1 && category) {
        errors.category = "Pick a valid category.";
      }

      if (!date) errors.date = "Choose a date.";

      return errors;
    },

    /* ---------------- statistics ---------------- */
    stats: function (list) {
      var monthKey = currentMonthKey();
      var today = todayKey();

      var totalThisMonth = 0;
      var monthCount = 0;
      var todaySpending = 0;
      var todayCount = 0;
      var largest = null;

      list.forEach(function (e) {
        var amt = Number(e.amount) || 0;
        if (monthKeyOf(e.date) === monthKey) {
          totalThisMonth += amt;
          monthCount++;
        }
        if (e.date === today) {
          todaySpending += amt;
          todayCount++;
        }
        if (!largest || amt > Number(largest.amount)) {
          largest = e;
        }
      });

      return {
        totalThisMonth: roundMoney(totalThisMonth),
        monthCount: monthCount,
        todaySpending: roundMoney(todaySpending),
        todayCount: todayCount,
        totalCount: list.length,
        largest: largest,
        monthKey: monthKey,
        monthLabel: monthLabel(monthKey)
      };
    },

    /*
     * Spending grouped by category for the current month, sorted high→low.
     * Returns [{ category, amount, pct }] where pct is share of the month.
     */
    spendingByCategory: function (list) {
      var monthKey = currentMonthKey();
      var totals = {};
      var grand = 0;
      list.forEach(function (e) {
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

    /* expose small date helpers other modules use */
    _util: { todayKey: todayKey, ymd: ymd, monthKeyOf: monthKeyOf, currentMonthKey: currentMonthKey, monthLabel: monthLabel }
  };

  /* "2026-08" -> "August 2026" */
  function monthLabel(key) {
    if (!key || key.length < 7) return key || "";
    var parts = key.split("-");
    var year = Number(parts[0]);
    var monthIdx = Number(parts[1]) - 1;
    var names = ["January","February","March","April","May","June","July","August","September","October","November","December"];
    if (monthIdx < 0 || monthIdx > 11) return key;
    return names[monthIdx] + " " + year;
  }

  ET.expenses = expenses;
})(window);
