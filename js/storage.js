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
  /* Recurring transactions & subscriptions (Part 7). */
  var RECURRING_KEY = "et_recurring_v1";
  /* Backup metadata (Part 8). */
  var BACKUP_META_KEY = "et_backup_meta_v1";
  var DEFAULT_CURRENCY = "AED";

  /* All keys owned by this application — used for safe full reset. */
  var APP_KEYS = [STORAGE_KEY, SHEETS_CONFIG_KEY, SHEETS_DELETES_KEY, BUDGETS_KEY, GOALS_KEY, RECURRING_KEY, BACKUP_META_KEY];

  var TYPES = ["expense", "income"];

  var _mutationListeners = [];
  var _mutationSuppressed = false;

  function _emit(type, payload) {
    if (_mutationSuppressed) return;
    _mutationListeners.forEach(function (fn) {
      try { fn(type, payload); } catch (e) { console.error("[Ledger] mutation listener error:", e); }
    });
  }

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
      var ok = writeRaw(list || []);
      if (ok) _emit("tx-replace", (list || []));
      return ok;
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
      _emit("tx-add", record);
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
          _emit("tx-update", all[i]);
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
      if (next.length !== all.length) {
        _emit("tx-delete", { id: id });
        return true;
      }
      return false;
    },

    newId: uid,

    /* Subscribe to data mutations (used by the Supabase sync layer). */
    onMutation: function (fn) {
      if (typeof fn === "function") _mutationListeners.push(fn);
    },

    /* While true, no mutation events are emitted (used while loading from
       the database or migrating so changes are not re-sent). */
    suppressMutations: function (flag) {
      _mutationSuppressed = !!flag;
    },

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
        _emit("budgets", config || {});
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
        _emit("goals", Array.isArray(list) ? list : []);
        return true;
      } catch (err) {
        console.error("[Ledger] Could not save goals:", err);
        return false;
      }
    },

    /* ---- Recurring transactions & subscriptions (Part 7) ---- */
    getRecurring: function () {
      try {
        var raw = global.localStorage.getItem(RECURRING_KEY);
        return raw ? JSON.parse(raw) : null;
      } catch (err) {
        console.error("[Ledger] Could not read recurring transactions:", err);
        return null;
      }
    },

    saveRecurring: function (list) {
      try {
        global.localStorage.setItem(RECURRING_KEY, JSON.stringify(Array.isArray(list) ? list : []));
        _emit("recurring", Array.isArray(list) ? list : []);
        return true;
      } catch (err) {
        console.error("[Ledger] Could not save recurring transactions:", err);
        return false;
      }
    },

    /* ---- Data management (Part 8) ---- */
    /* Overwrite the whole transaction store (used by restore). */
    replaceAllTransactions: function (list) {
      try {
        global.localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.isArray(list) ? list : []));
        _emit("tx-replace", (Array.isArray(list) ? list : []));
        return true;
      } catch (err) {
        console.error("[Ledger] Could not write transactions:", err);
        return false;
      }
    },

    clearTransactions: function () {
      try {
        global.localStorage.removeItem(STORAGE_KEY);
        return true;
      } catch (err) {
        console.error("[Ledger] Could not clear transactions:", err);
        return false;
      }
    },

    /* Remove all financial test data (transactions, budgets, goals, recurring). */
    clearTestData: function () {
      [STORAGE_KEY, BUDGETS_KEY, GOALS_KEY, RECURRING_KEY].forEach(function (k) {
        try { global.localStorage.removeItem(k); } catch (e) { /* ignore */ }
      });
      return true;
    },

    /* Remove every key this application owns (full reset). */
    resetAll: function () {
      APP_KEYS.forEach(function (k) {
        try { global.localStorage.removeItem(k); } catch (e) { /* ignore */ }
      });
      return true;
    },

    getBackupMeta: function () {
      try {
        var raw = global.localStorage.getItem(BACKUP_META_KEY);
        return raw ? JSON.parse(raw) : null;
      } catch (err) {
        console.error("[Ledger] Could not read backup metadata:", err);
        return null;
      }
    },

    saveBackupMeta: function (meta) {
      try {
        global.localStorage.setItem(BACKUP_META_KEY, JSON.stringify(meta || {}));
        return true;
      } catch (err) {
        console.error("[Ledger] Could not save backup metadata:", err);
        return false;
      }
    },

    /**
     * Rich sample financial profile for first-time exploration (UAE / AED).
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
      var currency = (ET.settings && ET.settings.getCurrency()) || DEFAULT_CURRENCY;
      var seed = [
        /* Income */
        { type: "income",  title: "Monthly Salary",      amount: 8000, category: "Salary",    vendor: "Company",       daysAgo: 27, hour: 8,  note: "Monthly payroll" },
        { type: "income",  title: "Freelance Work",      amount: 1200, category: "Freelance", vendor: "Client",        daysAgo: 9,  hour: 12, note: "Website project" },

        /* Rent */
        { type: "expense", title: "Monthly Rent",        amount: 2500, category: "Rent",      vendor: "Landlord",      daysAgo: 25, hour: 10, note: "" },

        /* Food & Groceries */
        { type: "expense", title: "Groceries",           amount: 245,  category: "Food & Groceries", vendor: "Carrefour",  daysAgo: 4,  hour: 17, note: "" },
        { type: "expense", title: "Groceries",           amount: 210,  category: "Food & Groceries", vendor: "Lulu",       daysAgo: 11, hour: 18, note: "" },
        { type: "expense", title: "Groceries",           amount: 190,  category: "Food & Groceries", vendor: "Carrefour",  daysAgo: 17, hour: 19, note: "" },
        { type: "expense", title: "Groceries",           amount: 95,   category: "Food & Groceries", vendor: "Spinneys",   daysAgo: 22, hour: 16, note: "" },
        { type: "expense", title: "Groceries",           amount: 85,   category: "Food & Groceries", vendor: "Carrefour",  daysAgo: 26, hour: 18, note: "" },
        { type: "expense", title: "Groceries",           amount: 120,  category: "Food & Groceries", vendor: "Carrefour",  daysAgo: 7,  hour: 19, note: "" },

        /* Restaurants & Coffee */
        { type: "expense", title: "Dinner",              amount: 75,   category: "Food & Groceries", vendor: "Talabat",    daysAgo: 2,  hour: 20, note: "" },
        { type: "expense", title: "Coffee",              amount: 28,   category: "Food & Groceries", vendor: "Starbucks",  daysAgo: 1,  hour: 9,  note: "" },
        { type: "expense", title: "Coffee",              amount: 42,   category: "Food & Groceries", vendor: "Costa",      daysAgo: 5,  hour: 10, note: "" },
        { type: "expense", title: "Lunch",               amount: 45,   category: "Food & Groceries", vendor: "Talabat",    daysAgo: 8,  hour: 13, note: "" },
        { type: "expense", title: "Coffee",              amount: 35,   category: "Food & Groceries", vendor: "Starbucks",  daysAgo: 13, hour: 9,  note: "" },
        { type: "expense", title: "Dinner",              amount: 32,   category: "Food & Groceries", vendor: "Talabat",    daysAgo: 19, hour: 20, note: "" },

        /* Transport */
        { type: "expense", title: "Petrol",              amount: 180,  category: "Transport", vendor: "ENOC",          daysAgo: 3,  hour: 8,  note: "" },
        { type: "expense", title: "Petrol",              amount: 150,  category: "Transport", vendor: "ENOC",          daysAgo: 12, hour: 8,  note: "" },
        { type: "expense", title: "Metro top-up",        amount: 100,  category: "Transport", vendor: "RTA Nol",       daysAgo: 16, hour: 8,  note: "" },
        { type: "expense", title: "Tolls",               amount: 50,   category: "Transport", vendor: "Salik",         daysAgo: 20, hour: 14, note: "" },
        { type: "expense", title: "Petrol",              amount: 120,  category: "Transport", vendor: "ENOC",          daysAgo: 24, hour: 8,  note: "" },

        /* Shopping */
        { type: "expense", title: "Online order",        amount: 210,  category: "Shopping",  vendor: "Amazon",        daysAgo: 6,  hour: 15, note: "" },
        { type: "expense", title: "Online order",        amount: 220,  category: "Shopping",  vendor: "Noon",          daysAgo: 10, hour: 16, note: "" },
        { type: "expense", title: "Online order",        amount: 180,  category: "Shopping",  vendor: "Amazon",        daysAgo: 15, hour: 17, note: "" },
        { type: "expense", title: "Online order",        amount: 95,   category: "Shopping",  vendor: "Amazon",        daysAgo: 23, hour: 18, note: "" },

        /* Bills */
        { type: "expense", title: "Electricity & water", amount: 320,  category: "Bills",     vendor: "DEWA",          daysAgo: 5,  hour: 9,  note: "" },
        { type: "expense", title: "Mobile & internet",   amount: 250,  category: "Bills",     vendor: "Etisalat",      daysAgo: 6,  hour: 10, note: "" },
        { type: "expense", title: "Internet",            amount: 199,  category: "Bills",     vendor: "ISP",           daysAgo: 14, hour: 11, note: "" },

        /* Entertainment */
        { type: "expense", title: "Cinema",              amount: 120,  category: "Entertainment", vendor: "VOX",      daysAgo: 9,  hour: 21, note: "" },
        { type: "expense", title: "Bookstore",           amount: 80,   category: "Entertainment", vendor: "Kinokuniya", daysAgo: 21, hour: 15, note: "" },
        { type: "expense", title: "Netflix",             amount: 55,   category: "Entertainment", vendor: "Netflix",   daysAgo: 3,  hour: 20, note: "Monthly plan" },
        { type: "expense", title: "Spotify",             amount: 25,   category: "Entertainment", vendor: "Spotify",   daysAgo: 18, hour: 20, note: "Monthly plan" },

        /* Health */
        { type: "expense", title: "Gym membership",      amount: 120,  category: "Health",    vendor: "Gym",           daysAgo: 4,  hour: 7,  note: "" }
      ];
      return seed.map(function (s) {
        var created = ts(s.daysAgo, s.hour);
        return {
          id: uid(),
          type: s.type,
          title: s.title,
          amount: s.amount,
          currency: currency,
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

    buildSampleBudgets: function () {
      return {
        monthly: 6500,
        categories: {
          "Food & Groceries": 1300,
          "Transport": 650,
          "Shopping": 800,
          "Bills": 900,
          "Entertainment": 400,
          "Health": 200,
          "Rent": 2500
        }
      };
    },

    buildSampleGoals: function () {
      function iso(daysAgo) {
        var d = new Date();
        d.setDate(d.getDate() - daysAgo);
        var y = d.getFullYear();
        var m = String(d.getMonth() + 1).padStart(2, "0");
        var day = String(d.getDate()).padStart(2, "0");
        return y + "-" + m + "-" + day;
      }
      var now = Date.now();
      function contribution(id, amount, daysAgo) {
        var c = now - daysAgo * 86400000;
        return { id: uid(), amount: amount, date: iso(daysAgo), note: "", createdAt: c };
      }
      var goals = [
        {
          id: uid(),
          name: "Emergency Fund",
          target: 20000,
          currency: (ET.settings && ET.settings.getCurrency()) || DEFAULT_CURRENCY,
          deadline: "",
          createdAt: now - 40 * 86400000,
          updatedAt: now,
          contributions: [
            contribution(uid(), 1000, 28),
            contribution(uid(), 1000, 18),
            contribution(uid(), 1000, 8),
            contribution(uid(), 1000, 1)
          ]
        },
        {
          id: uid(),
          name: "Dubai Weekend",
          target: 5000,
          currency: (ET.settings && ET.settings.getCurrency()) || DEFAULT_CURRENCY,
          deadline: "",
          createdAt: now - 20 * 86400000,
          updatedAt: now,
          contributions: [
            contribution(uid(), 600, 12),
            contribution(uid(), 600, 5)
          ]
        }
      ];
      return goals;
    },

    buildSampleRecurring: function () {
      function isoOffset(daysFromNow) {
        var d = new Date();
        d.setDate(d.getDate() + daysFromNow);
        var y = d.getFullYear();
        var m = String(d.getMonth() + 1).padStart(2, "0");
        var day = String(d.getDate()).padStart(2, "0");
        return y + "-" + m + "-" + day;
      }
      var now = Date.now();
      var currency = (ET.settings && ET.settings.getCurrency()) || DEFAULT_CURRENCY;
      function def(o) {
        return {
          id: uid(),
          type: o.type || "expense",
          title: o.title,
          amount: o.amount,
          currency: currency,
          category: o.category,
          vendor: o.vendor || "",
          notes: o.notes || "",
          frequency: "monthly",
          startDate: isoOffset(-60),
          nextDueDate: isoOffset(o.dueIn),
          lastGeneratedDate: "",
          isSubscription: !!o.subscription,
          status: "active",
          needsReview: false,
          createdAt: now,
          updatedAt: now
        };
      }
      return [
        def({ title: "Monthly Rent",      amount: 2500, category: "Rent",          dueIn: 1,  note: "Rent due" }),
        def({ title: "Salary",            amount: 8000, category: "Salary",        dueIn: 1,  type: "income" }),
        def({ title: "Netflix",           amount: 55,   category: "Entertainment", dueIn: 3,  subscription: true }),
        def({ title: "Gym membership",    amount: 120,  category: "Health",        dueIn: 4,  vendor: "Gym" }),
        def({ title: "Spotify",           amount: 25,   category: "Entertainment", dueIn: 5,  subscription: true }),
        def({ title: "Electricity & water", amount: 320, category: "Bills",        dueIn: 6,  vendor: "DEWA" }),
        def({ title: "Mobile & internet", amount: 250,  category: "Bills",         dueIn: 8,  vendor: "Etisalat" })
      ];
    },

    /** Write the full sample profile (transactions, budgets, goals, recurring). */
    loadSampleData: function () {
      var samples = this.buildSampleData();
      this.replaceAllTransactions(samples);
      if (ET.budgets) ET.budgets.saveBudgetsConfig(this.buildSampleBudgets());
      if (ET.budgets) this.saveGoals(this.buildSampleGoals());
      if (ET.recurring) this.saveRecurring(this.buildSampleRecurring());
      return samples;
    }
  };

  ET.storage = storage;
})(window);
