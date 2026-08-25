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

  var STORAGE_KEY = "et_expenses_v1";
  var DEFAULT_CURRENCY = "AED";

  /* The eight fixed categories. Single source of truth — the form select,
     the filter select, badges and validation all read from here. */
  var CATEGORIES = [
    "Food & Groceries",
    "Transport",
    "Shopping",
    "Bills",
    "Entertainment",
    "Health",
    "Education",
    "Other"
  ];

  /* Map a category name to a CSS class used for its coloured badge/dot. */
  var CATEGORY_SLUGS = {
    "Food & Groceries": "cat-food",
    "Transport": "cat-transport",
    "Shopping": "cat-shopping",
    "Bills": "cat-bills",
    "Entertainment": "cat-entertainment",
    "Health": "cat-health",
    "Education": "cat-education",
    "Other": "cat-other"
  };

  /* ---- id generation ---- */
  function uid() {
    if (global.crypto && typeof global.crypto.randomUUID === "function") {
      return global.crypto.randomUUID();
    }
    // Fallback for older browsers / file:// contexts
    return "exp-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
  }

  /* ---- low-level read / write ---- */
  function readRaw() {
    try {
      var raw = global.localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      var parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      console.error("[Ledger] Could not read stored expenses:", err);
      return [];
    }
  }

  function writeRaw(list) {
    try {
      global.localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
      return true;
    } catch (err) {
      console.error("[Ledger] Could not save expenses:", err);
      return false;
    }
  }

  /* ---- public API ---- */
  var storage = {
    STORAGE_KEY: STORAGE_KEY,
    DEFAULT_CURRENCY: DEFAULT_CURRENCY,
    CATEGORIES: CATEGORIES,
    CATEGORY_SLUGS: CATEGORY_SLUGS,

    categorySlug: function (category) {
      return CATEGORY_SLUGS[category] || "cat-other";
    },

    /** Return every stored expense (unsorted copy). */
    getAll: function () {
      return readRaw();
    },

    /** Replace the whole collection. */
    saveAll: function (list) {
      return writeRaw(list || []);
    },

    /** Find one expense by id (or null). */
    get: function (id) {
      var all = readRaw();
      for (var i = 0; i < all.length; i++) {
        if (all[i].id === id) return all[i];
      }
      return null;
    },

    /** Insert a fully-formed expense record. */
    add: function (expense) {
      var all = readRaw();
      all.push(expense);
      writeRaw(all);
      return expense;
    },

    /** Merge changes into the expense with matching id. */
    update: function (id, changes) {
      var all = readRaw();
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

    /** Remove the expense with matching id. */
    remove: function (id) {
      var all = readRaw();
      var next = all.filter(function (e) { return e.id !== id; });
      writeRaw(next);
      return next.length !== all.length;
    },

    /** Generate a new unique id. */
    newId: uid,

    /**
     * Realistic sample expenses for first-time exploration.
     * Dates are generated relative to "today" so the dashboard (which is
     * month/day aware) always has something meaningful to show.
     * NOTE: this is only ever called from an explicit user action —
     * the app never auto-seeds, so deleting samples makes them stay gone.
     */
    buildSampleData: function () {
      function iso(daysAgo) {
        var d = new Date();
        d.setDate(d.getDate() - daysAgo);
        return d.toISOString().slice(0, 10);
      }
      function ts(daysAgo, hour) {
        var d = new Date();
        d.setDate(d.getDate() - daysAgo);
        d.setHours(hour || 9, 0, 0, 0);
        return d.getTime();
      }
      var seed = [
        { title: "Sugar",           amount: 12,   category: "Food & Groceries", vendor: "Carrefour",   daysAgo: 0,  note: "" },
        { title: "Lunch",           amount: 35,   category: "Food & Groceries", vendor: "Restaurant",  daysAgo: 0,  note: "Team lunch" },
        { title: "Petrol",          amount: 150,  category: "Transport",        vendor: "ENOC",        daysAgo: 1,  note: "Full tank" },
        { title: "Netflix",         amount: 45,   category: "Entertainment",    vendor: "Netflix",     daysAgo: 2,  note: "Monthly plan" },
        { title: "Groceries",       amount: 220,  category: "Food & Groceries", vendor: "Lulu",        daysAgo: 3,  note: "Weekly shop" },
        { title: "DEWA bill",       amount: 310,  category: "Bills",            vendor: "DEWA",        daysAgo: 4,  note: "Electricity + water" },
        { title: "Taxi",            amount: 28,   category: "Transport",        vendor: "Careem",      daysAgo: 5,  note: "" },
        { title: "Pharmacy",        amount: 64,   category: "Health",           vendor: "Aster",       daysAgo: 6,  note: "Vitamins" },
        { title: "T-shirt",         amount: 89,   category: "Shopping",         vendor: "Uniqlo",      daysAgo: 8,  note: "" },
        { title: "Online course",   amount: 120,  category: "Education",        vendor: "Coursera",    daysAgo: 11, note: "Data course" },
        { title: "Coffee",          amount: 22,   category: "Food & Groceries", vendor: "Starbucks",   daysAgo: 12, note: "" },
        { title: "Cinema",          amount: 90,   category: "Entertainment",    vendor: "Vox",         daysAgo: 14, note: "Two tickets" }
      ];
      return seed.map(function (s) {
        return {
          id: uid(),
          title: s.title,
          amount: s.amount,
          currency: DEFAULT_CURRENCY,
          category: s.category,
          vendor: s.vendor,
          date: iso(s.daysAgo),
          notes: s.note,
          createdAt: ts(s.daysAgo, 9),
          updatedAt: ts(s.daysAgo, 9)
        };
      });
    },

    /** Write the sample set (replacing anything present). */
    loadSampleData: function () {
      var samples = this.buildSampleData();
      writeRaw(samples);
      return samples;
    }
  };

  ET.storage = storage;
})(window);
