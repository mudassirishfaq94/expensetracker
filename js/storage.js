/* =========================================================================
   storage.js — persistence layer
   Everything that touches localStorage lives here. Nothing else in the app
   reads or writes localStorage directly, so a future module (e.g. a Google
   Sheets sync) can swap this one file out.

   Attaches to the shared global: window.ET.storage
   ========================================================================= */
(function (global) {
  "use strict";

  var ET = (global.ET = global.ET || {});

  /* Same key as Part 1 so existing local data is not orphaned. */
  var STORAGE_KEY = "et_expenses_v1";
  /* Google Sheets connection config + pending remote actions (Part 4). */
  var SHEETS_CONFIG_KEY = "et_sheets_config_v1";
  var SHEETS_DELETES_KEY = "et_sheets_pending_deletes_v1";
  /* Budgets & goals (Part 6). */
  var BUDGETS_KEY = "et_budgets_v1";
  var GOALS_KEY = "et_goals_v1";
  var DEFAULT_CURRENCY = "AED";

  var TYPES = ["expense", "income"];

  var EXPENSE_CATEGORIES = [
    "Food & Groceries",
    "Transport",
    "Shopping",
    "Bills",
    "Entertainment",
    "Health",
    "Education",
    "Rent",
    "Travel",
    "Other"
  ];

  var INCOME_CATEGORIES = [
    "Salary",
    "Freelance",
    "Business",
    "Investment",
    "Rental Income",
    "Gift",
    "Refund",
    "Other Income"
  ];

  /* Legacy alias used by older UI code. Expense categories are the default. */
  var CATEGORIES = EXPENSE_CATEGORIES;

  var CATEGORY_SLUGS = {
    "Food & Groceries": "cat-food",
    "Transport": "cat-transport",
    "Shopping": "cat-shopping",
    "Bills": "cat-bills",
    "Entertainment": "cat-entertainment",
    "Health": "cat-health",
    "Education": "cat-education",
    "Rent": "cat-rent",
    "Travel": "cat-travel",
    "Other": "cat-other",
    "Salary": "cat-salary",
    "Freelance": "cat-freelance",
    "Business": "cat-business",
    "Investment": "cat-investment",
    "Rental Income": "cat-rental",
    "Gift": "cat-gift",
    "Refund": "cat-refund",
    "Other Income": "cat-other-income"
  };

  /* ---- id generation ---- */
  function uid() {
    if (global.crypto && typeof global.crypto.randomUUID === "function") {
      return global.crypto.randomUUID();
    }
    return "txn-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
  }

  function isIncome(type) {
    return type === "income";
  }

  function normalizeType(type) {
    return type === "income" ? "income" : "expense";
  }

  function categoriesFor(type) {
    return isIncome(type) ? INCOME_CATEGORIES.slice() : EXPENSE_CATEGORIES.slice();
  }

  function allCategories() {
    return EXPENSE_CATEGORIES.concat(INCOME_CATEGORIES);
  }

  /* Part 1 records had no `type`. Treat those as expenses and persist once. */
  function migrateRecord(record) {
    if (!record || typeof record !== "object") return { record: record, changed: false };
    var changed = false;
    var next = record;

    if (next.type !== "income" && next.type !== "expense") {
      next.type = "expense";
      changed = true;
    }
    if (typeof next.amount !== "number" || !isFinite(next.amount)) {
      next.amount = Number(next.amount) || 0;
      changed = true;
    }
    if (!next.currency) {
      next.currency = DEFAULT_CURRENCY;
      changed = true;
    }
    if (next.updatedAt == null) {
      next.updatedAt = next.createdAt || Date.now();
      changed = true;
    }
    if (next.createdAt == null) {
      next.createdAt = next.updatedAt || Date.now();
      changed = true;
    }
    /* Part 4: legacy records are unsynced until Google Sheets is connected. */
    if (next.syncStatus !== "synced" && next.syncStatus !== "failed" && next.syncStatus !== "pending") {
      next.syncStatus = "pending";
      changed = true;
    }
    return { record: next, changed: changed };
  }

  function migrateList(list) {
    var changed = false;
    var next = (list || []).map(function (item) {
      var result = migrateRecord(item);
      if (result.changed) changed = true;
      return result.record;
    });
    return { list: next, changed: changed };
  }

  /* ---- low-level read / write ---- */
  function readRaw() {
    try {
      var raw = global.localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      var parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      console.error("[Ledger] Could not read stored transactions:", err);
      return [];
    }
  }

  function writeRaw(list) {
    try {
      global.localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
      return true;
    } catch (err) {
      console.error("[Ledger] Could not save transactions:", err);
      return false;
    }
  }

  function readMigrated() {
    var migrated = migrateList(readRaw());
    if (migrated.changed) writeRaw(migrated.list);
    return migrated.list;
  }

  /* ---- public API ---- */
  var storage = {
    STORAGE_KEY: STORAGE_KEY,
    DEFAULT_CURRENCY: DEFAULT_CURRENCY,
    TYPES: TYPES,
    EXPENSE_CATEGORIES: EXPENSE_CATEGORIES,
    INCOME_CATEGORIES: INCOME_CATEGORIES,
    CATEGORIES: CATEGORIES,
    CATEGORY_SLUGS: CATEGORY_SLUGS,

    normalizeType: normalizeType,
    isIncome: isIncome,
    categoriesFor: categoriesFor,
    allCategories: allCategories,

    categorySlug: function (category) {
      return CATEGORY_SLUGS[category] || "cat-other";
    },

    /** Return every stored transaction (unsorted copy, migrated). */
    getAll: function () {
      return readMigrated();
    },

    /** Replace the whole collection. */
    saveAll: function (list) {
      return writeRaw(list || []);
    },

    /** Find one transaction by id (or null). */
    get: function (id) {
      var all = readMigrated();
      for (var i = 0; i < all.length; i++) {
        if (all[i].id === id) return all[i];
      }
      return null;
    },

    /** Insert a fully-formed transaction record. */
    add: function (record) {
      var all = readMigrated();
      all.push(record);
      writeRaw(all);
      return record;
    },

    /** Merge changes into the transaction with matching id. */
    update: function (id, changes) {
      var all = readMigrated();
      for (var i = 0; i < all.length; i++) {
        if (all[i].id === id) {
          for (var k in changes) {
            if (Object.prototype.hasOwnProperty.call(changes, k)) {
              all[i][k] = changes[k];
            }
          }
          writeRaw(all);
          return all[i];
        }
      }
      return null;
    },

    /** Remove the transaction with matching id. */
    remove: function (id) {
      var all = readMigrated();
      var next = all.filter(function (e) { return e.id !== id; });
      writeRaw(next);
      return next.length !== all.length;
    },

    newId: uid,

    /* ---- Google Sheets connection config (Part 4) ---- */
    getSheetsConfig: function () {
      try {
        var raw = global.localStorage.getItem(SHEETS_CONFIG_KEY);
        return raw ? JSON.parse(raw) : null;
      } catch (err) {
        console.error("[Ledger] Could not read sheets config:", err);
        return null;
      }
    },

    saveSheetsConfig: function (config) {
      try {
        global.localStorage.setItem(SHEETS_CONFIG_KEY, JSON.stringify(config || {}));
        return true;
      } catch (err) {
        console.error("[Ledger] Could not save sheets config:", err);
        return false;
      }
    },

    clearSheetsConfig: function () {
      try {
        global.localStorage.removeItem(SHEETS_CONFIG_KEY);
        return true;
      } catch (err) {
        console.error("[Ledger] Could not clear sheets config:", err);
        return false;
      }
    },

    /* IDs of locally-deleted transactions whose remote row still needs removal. */
    getPendingRemoteDeletes: function () {
      try {
        var raw = global.localStorage.getItem(SHEETS_DELETES_KEY);
        var arr = raw ? JSON.parse(raw) : [];
        return Array.isArray(arr) ? arr : [];
      } catch (err) {
        console.error("[Ledger] Could not read pending deletes:", err);
        return [];
      }
    },

    savePendingRemoteDeletes: function (ids) {
      try {
        global.localStorage.setItem(SHEETS_DELETES_KEY, JSON.stringify(Array.isArray(ids) ? ids : []));
        return true;
      } catch (err) {
        console.error("[Ledger] Could not save pending deletes:", err);
        return false;
      }
    },

    /* ---- Budgets & goals (Part 6) ---- */
    getBudgetsConfig: function () {
      try {
        var raw = global.localStorage.getItem(BUDGETS_KEY);
        return raw ? JSON.parse(raw) : null;
      } catch (err) {
        console.error("[Ledger] Could not read budgets:", err);
        return null;
      }
    },

    saveBudgetsConfig: function (config) {
      try {
        global.localStorage.setItem(BUDGETS_KEY, JSON.stringify(config || {}));
        return true;
      } catch (err) {
        console.error("[Ledger] Could not save budgets:", err);
        return false;
      }
    },

    getGoals: function () {
      try {
        var raw = global.localStorage.getItem(GOALS_KEY);
        return raw ? JSON.parse(raw) : null;
      } catch (err) {
        console.error("[Ledger] Could not read goals:", err);
        return null;
      }
    },

    saveGoals: function (list) {
      try {
        global.localStorage.setItem(GOALS_KEY, JSON.stringify(Array.isArray(list) ? list : []));
        return true;
      } catch (err) {
        console.error("[Ledger] Could not save goals:", err);
        return false;
      }
    },

    /**
     * Sample income + expenses for first-time exploration.
     * Dates are local (not UTC) so dashboard month/day stats line up.
     * Only called from an explicit user action — never auto-seeded.
     */
    buildSampleData: function () {
      function iso(daysAgo) {
        var d = new Date();
        d.setDate(d.getDate() - daysAgo);
        var y = d.getFullYear();
        var m = String(d.getMonth() + 1).padStart(2, "0");
        var day = String(d.getDate()).padStart(2, "0");
        return y + "-" + m + "-" + day;
      }
      function ts(daysAgo, hour) {
        var d = new Date();
        d.setDate(d.getDate() - daysAgo);
        d.setHours(hour || 9, 0, 0, 0);
        return d.getTime();
      }
      var seed = [
        { type: "income",  title: "Monthly Salary",            amount: 8000, category: "Salary",            vendor: "Company Name", daysAgo: 20, hour: 8,  note: "August payroll" },
        { type: "income",  title: "Freelance Website Project", amount: 1500, category: "Freelance",         vendor: "Client",       daysAgo: 6,  hour: 11, note: "" },
        { type: "income",  title: "Refund",                    amount: 200,  category: "Refund",            vendor: "Carrefour",    daysAgo: 2,  hour: 14, note: "Returned item" },
        { type: "expense", title: "Sugar",                     amount: 12,   category: "Food & Groceries",  vendor: "Carrefour",    daysAgo: 0,  hour: 10, note: "" },
        { type: "expense", title: "Lunch",                     amount: 35,   category: "Food & Groceries",  vendor: "Restaurant",   daysAgo: 0,  hour: 13, note: "" },
        { type: "expense", title: "Petrol",                    amount: 150,  category: "Transport",         vendor: "ENOC",         daysAgo: 1,  hour: 9,  note: "" },
        { type: "expense", title: "Netflix",                   amount: 45,   category: "Entertainment",     vendor: "Netflix",      daysAgo: 3,  hour: 19, note: "Monthly plan" },
        { type: "expense", title: "Internet Bill",             amount: 399,  category: "Bills",             vendor: "Etisalat",     daysAgo: 5,  hour: 16, note: "" }
      ];
      return seed.map(function (s) {
        var created = ts(s.daysAgo, s.hour);
        return {
          id: uid(),
          type: s.type,
          title: s.title,
          amount: s.amount,
          currency: DEFAULT_CURRENCY,
          category: s.category,
          vendor: s.vendor,
          date: iso(s.daysAgo),
          notes: s.note,
          createdAt: created,
          updatedAt: created,
          syncStatus: "pending"
        };
      });
    },

    /** Write the sample set (replacing anything present). Explicit user action only. */
    loadSampleData: function () {
      var samples = this.buildSampleData();
      writeRaw(samples);
      return samples;
    }
  };

  ET.storage = storage;
})(window);
