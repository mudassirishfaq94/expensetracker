/* =========================================================================
   database.js — Supabase data access layer (Part 9)
   Provides CRUD operations for every entity, cloud mode management, and
   subscribes to storage mutation events so local changes automatically sync
   to Supabase when cloud mode is active.

   When cloud mode is OFF the app runs entirely in LocalStorage mode.
   When cloud mode is ON every mutation is synced to Supabase (debounced);
   data is loaded from Supabase on app start.

   Attaches to: window.ET.database
   ========================================================================= */
(function (global) {
  "use strict";

  var ET = (global.ET = global.ET || {});
  var storage = ET.storage;

  var cloudMode = false;
  var _debounceTimer = null;
  var _mutationSubscribed = false;

  function client() { return (ET.supabase && ET.supabase.getClient()) || null; }

  function isConfigured() { return ET.supabase && ET.supabase.isConfigured(); }

  function isCloudMode() { return cloudMode && isConfigured() && ET.auth && ET.auth.hasSession(); }

  function setCloudMode(flag) { cloudMode = !!flag; }

  /* --------------------------- field mapping --------------------------- */

  /**
   * Map a local (frontend camelCase) transaction to the real Supabase row.
   * Must match the transactions table schema exactly.
   */
  function localTransactionToDb(local, userId) {
    var now = new Date().toISOString();
    return {
      id: String(local.id || ""),
      user_id: userId,
      type: local.type === "income" ? "income" : "expense",
      title: String(local.title == null ? "" : local.title),
      amount: Number(local.amount) || 0,
      currency: String(local.currency || (ET.settings ? ET.settings.getCurrency() : "AED")),
      category: String(local.category == null ? "" : local.category),
      vendor_source: String(local.vendor == null ? "" : local.vendor),
      date: local.date || null,
      notes: String(local.notes == null ? "" : local.notes),
      recurring_id: local.recurringId || local.recurring_id || null,
      created_at: local.createdAt ? new Date(local.createdAt).toISOString() : now,
      updated_at: local.updatedAt ? new Date(local.updatedAt).toISOString() : now,
      sync_status: "synced"
    };
  }

  /**
   * Map a Supabase row back to the local (frontend camelCase) transaction
   * record shape used by the UI.
   */
  function dbTransactionToLocal(row) {
    if (!row) return null;
    return {
      id: String(row.id || ""),
      type: row.type === "income" ? "income" : "expense",
      title: String(row.title || ""),
      amount: Number(row.amount) || 0,
      currency: String(row.currency || "AED"),
      category: String(row.category || ""),
      vendor: String(row.vendor_source || ""),
      date: row.date || "",
      notes: String(row.notes || ""),
      createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
      updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : Date.now(),
      syncStatus: row.sync_status || "synced",
      recurringId: row.recurring_id || ""
    };
  }

  /**
   * CENTRAL transaction creation function.
   * Every transaction creation path (manual form, income, expense, natural
   * language, recurring generation, quick-add) must eventually call this.
   *
   * 1. Verify the authenticated user.
   * 2. Validate the transaction.
   * 3. Map frontend fields to the real database schema.
   * 4. Insert the transaction into Supabase.
   * 5. Wait for confirmation.
   * 6. Return the actual saved database row.
   * 7. Throw an error if saving fails.
   */
  async function createTransaction(input) {
    var c = client();
    if (!c) throw new Error("Cloud storage is not configured.");

    var user = (ET.auth && ET.auth.getUser()) || null;
    if (!user) {
      var res = await c.auth.getUser();
      if (res.error || !res.data || !res.data.user) {
        throw new Error("You must be logged in to save a transaction.");
      }
      user = res.data.user;
    }

    console.log("Authenticated user:", user.id);

    var errors = ET.transactions ? ET.transactions.validate(input) : {};
    if (errors && Object.keys(errors).length > 0) {
      var err = new Error("Transaction is invalid.");
      err.validation = errors;
      throw err;
    }

    var id = (input && input.id) || (storage.newId ? storage.newId() : crypto.randomUUID());
    var nowIso = new Date().toISOString();
    var transactionToInsert = {
      id: id,
      user_id: user.id,
      type: (input && input.type) === "income" ? "income" : "expense",
      title: String((input && input.title) || ""),
      amount: Number(input && input.amount) || 0,
      currency: String((input && input.currency) || (ET.settings ? ET.settings.getCurrency() : "AED")),
      category: String((input && input.category) || ""),
      vendor_source: String((input && (input.vendor || input.vendorSource || input.vendor_source)) || ""),
      date: (input && input.date) || null,
      notes: String((input && input.notes) || ""),
      recurring_id: (input && (input.recurringId || input.recurring_id)) || null,
      created_at: nowIso,
      updated_at: nowIso,
      sync_status: "synced"
    };

    console.log("Attempting Supabase transaction insert:", transactionToInsert);

    var result = await c.from("transactions").insert([transactionToInsert]).select().single();

    if (result.error) {
      console.error("SUPABASE INSERT ERROR:", JSON.stringify(result.error, null, 2));
      throw result.error;
    }

    console.log("Transaction successfully saved:", result.data);
    return result.data;
  }

  /* --------------------------- user settings --------------------------- */

  async function fetchUserSettings() {
    var c = client();
    var user = ET.auth && ET.auth.getUser();
    if (!c || !user) return null;
    var res = await c.from("user_settings").select("*").eq("user_id", user.id).maybeSingle();
    return res.data || null;
  }

  async function createDefaultSettings() {
    var c = client();
    var user = ET.auth && ET.auth.getUser();
    if (!c || !user) return null;
    var res = await c.from("user_settings").upsert({
      user_id: user.id,
      currency: "AED",
      theme: "light",
      date_format: "dd mmm yyyy",
      timezone: "UTC",
      updated_at: new Date().toISOString()
    }, { onConflict: "user_id" });
    if (res.error) throw res.error;
    return res.data;
  }

  async function updateUserSettings(settings) {
    var c = client();
    var user = ET.auth && ET.auth.getUser();
    if (!c || !user) return null;
    var res = await c.from("user_settings").upsert(
      Object.assign({ user_id: user.id, updated_at: new Date().toISOString() }, settings),
      { onConflict: "user_id" }
    );
    if (res.error) throw res.error;
    return res.data;
  }

  /* --------------------------- debounced sync --------------------------- */

  function scheduleSync() {
    if (!isCloudMode()) return;
    if (_debounceTimer) { clearTimeout(_debounceTimer); _debounceTimer = null; }
    _debounceTimer = setTimeout(function () {
      _debounceTimer = null;
      ET.database.syncAll();
    }, 500);
  }

  function subscribeToMutations() {
    if (_mutationSubscribed) return;
    _mutationSubscribed = true;
    storage.onMutation(function (type, payload) {
      if (!isCloudMode()) return;
      scheduleSync();
    });
  }

  /* ------------------------------- loadAll ------------------------------ */

  /**
   * Fetch all data for the current user from Supabase and populate the
   * local storage layer. Mutation events are suppressed during this.
   */
  async function loadAll() {
    var c = client();
    var user = ET.auth && ET.auth.getUser();
    if (!c || !user) return { ok: false, reason: "Not authenticated" };

    storage.suppressMutations(true);

    try {
      /* Transactions — mapped from DB snake_case to local camelCase */
      var txRes = await c.from("transactions").select("*").eq("user_id", user.id).order("created_at", { ascending: false });
      if (txRes.error) throw txRes.error;
      storage.replaceAllTransactions((txRes.data || []).map(dbTransactionToLocal));

      /* Budgets */
      var bRes = await c.from("budgets").select("*").eq("user_id", user.id).maybeSingle();
      var catBRes = await c.from("category_budgets").select("*").eq("user_id", user.id);
      var monthly = (bRes.data && Number(bRes.data.monthly_budget)) || 0;
      var cats = {};
      (catBRes.data || []).forEach(function (r) { cats[r.category] = r.amount; });
      storage.saveBudgetsConfig({ monthly: monthly, categories: cats });

      /* Goals — mapped from DB snake_case to local camelCase */
      var gRes = await c.from("financial_goals").select("*").eq("user_id", user.id);
      var gcRes = await c.from("goal_contributions").select("*").eq("user_id", user.id);
      var contribsByGoal = {};
      (gcRes.data || []).forEach(function (gc) {
        if (!contribsByGoal[gc.goal_id]) contribsByGoal[gc.goal_id] = [];
        contribsByGoal[gc.goal_id].push({
          id: gc.id,
          amount: Number(gc.amount) || 0,
          date: gc.date || "",
          note: gc.note || "",
          createdAt: gc.created_at ? new Date(gc.created_at).getTime() : Date.now()
        });
      });
      var goals = (gRes.data || []).map(function (g) {
        return {
          id: g.id,
          name: String(g.title || ""),
          target: Number(g.target_amount) || 0,
          currency: String(g.currency || "AED"),
          deadline: g.target_date || "",
          createdAt: g.created_at ? new Date(g.created_at).getTime() : Date.now(),
          updatedAt: g.updated_at ? new Date(g.updated_at).getTime() : Date.now(),
          contributions: contribsByGoal[g.id] || []
        };
      });
      storage.saveGoals(goals);

      /* Recurring — mapped from DB snake_case to local camelCase */
      var rRes = await c.from("recurring_transactions").select("*").eq("user_id", user.id);
      var recurring = (rRes.data || []).map(function (r) {
        return {
          id: r.id,
          type: r.type === "income" ? "income" : "expense",
          title: String(r.title || ""),
          amount: Number(r.amount) || 0,
          currency: String(r.currency || "AED"),
          category: String(r.category || ""),
          vendor: String(r.vendor_source || ""),
          notes: String(r.notes || ""),
          frequency: r.frequency || "monthly",
          startDate: r.start_date || "",
          nextDueDate: r.next_due_date || "",
          lastGeneratedDate: r.last_generated_date || "",
          isSubscription: !!r.is_subscription,
          status: r.status === "paused" ? "paused" : "active",
          needsReview: !!r.needs_review,
          createdAt: r.created_at ? new Date(r.created_at).getTime() : Date.now(),
          updatedAt: r.updated_at ? new Date(r.updated_at).getTime() : Date.now()
        };
      });
      storage.saveRecurring(recurring);

      return { ok: true };
    } finally {
      storage.suppressMutations(false);
    }
  }

  /* ------------------------------- syncAll ------------------------------- */

  /**
   * Push the current local state to Supabase (upsert every entity).
   * Called automatically on mutation (debounced) when cloud mode is active.
   */
  async function syncAll() {
    if (!isCloudMode()) return { ok: false };
    var c = client();
    var user = ET.auth && ET.auth.getUser();
    if (!c || !user) return { ok: false, reason: "Not authenticated" };

    try {
      /* Transactions — map local camelCase records to the real DB schema */
      var txs = ET.transactions ? ET.transactions.all() : [];
      if (txs.length) {
        var dbRows = txs.map(function (t) { return localTransactionToDb(t, user.id); });
        await c.from("transactions").upsert(dbRows, { onConflict: "id", ignoreDuplicates: false });
      }

      /* Budgets */
      var cfg = ET.budgets ? ET.budgets.getBudgetsConfig() : { monthly: 0, categories: {} };
      var defaultCurrency = ET.settings ? ET.settings.getCurrency() : "AED";
      await c.from("budgets").upsert({ user_id: user.id, monthly_budget: cfg.monthly || 0, currency: defaultCurrency }, { onConflict: "user_id" });
      var catBuds = Object.keys(cfg.categories || {}).map(function (cat) {
        return { id: "cb_" + user.id + "_" + cat, user_id: user.id, category: cat, amount: cfg.categories[cat] || 0, currency: defaultCurrency };
      });
      if (catBuds.length) {
        await c.from("category_budgets").upsert(catBuds, { onConflict: "id" });
      }

      /* Goals */
      var goals = ET.budgets ? ET.budgets.getGoals() : [];
      var goalLines = goals.map(function (g) {
        return { id: g.id, user_id: user.id, title: g.name || "", target_amount: g.target || 0, currency: g.currency || defaultCurrency, target_date: g.deadline || null };
      });
      if (goalLines.length) {
        await c.from("financial_goals").upsert(goalLines, { onConflict: "id" });
      }
      var allContribs = [];
      goals.forEach(function (g) {
        (g.contributions || []).forEach(function (c2) {
          allContribs.push({ id: c2.id, user_id: user.id, goal_id: g.id, amount: c2.amount || 0, date: c2.date || null, note: c2.note || "" });
        });
      });
      if (allContribs.length) {
        await c.from("goal_contributions").upsert(allContribs, { onConflict: "id" });
      }

      /* Recurring */
      var recs = ET.recurring ? ET.recurring.getRecurring() : [];
      var recLines = recs.map(function (r) {
        return {
          id: r.id, user_id: user.id, type: r.type || "expense", title: r.title || "", amount: r.amount || 0,
          currency: r.currency || defaultCurrency, category: r.category || "", vendor_source: r.vendor || "", notes: r.notes || "",
          frequency: r.frequency || "monthly", start_date: r.startDate || null, next_due_date: r.nextDueDate || null,
          last_generated_date: r.lastGeneratedDate || null, status: r.status || "active", is_subscription: !!r.isSubscription,
          needs_review: !!r.needsReview
        };
      });
      if (recLines.length) {
        await c.from("recurring_transactions").upsert(recLines, { onConflict: "id" });
      }

      return { ok: true };
    } catch (err) {
      console.error("[Ledger] syncAll error:", err);
      return { ok: false, reason: err && err.message ? err.message : "Sync failed" };
    }
  }

  /* ---------------------------- profile --------------------------------- */

  async function ensureProfile() {
    var c = client();
    var user = ET.auth && ET.auth.getUser();
    if (!c || !user) return null;
    var res = await c.from("profiles").select("*").eq("id", user.id).maybeSingle();
    if (res.error && res.error.code !== "PGRST116") {
      console.error("[Ledger] Could not fetch profile:", res.error);
    }
    if (res.data) return res.data;
    /* Profile should be created by the DB trigger, but as a fallback: */
    var fullName = (user.user_metadata && user.user_metadata.full_name) || user.email || "";
    var ins = await c.from("profiles").upsert({ id: user.id, full_name: fullName }, { onConflict: "id" });
    if (ins.error) console.error("[Ledger] Could not create profile:", ins.error);
    return ins.data;
  }

  async function fetchProfile() {
    var c = client();
    var user = ET.auth && ET.auth.getUser();
    if (!c || !user) return null;
    var res = await c.from("profiles").select("*").eq("id", user.id).maybeSingle();
    if (res.data) return res.data;
    return null;
  }

  async function updateProfileName(fullName) {
    var c = client();
    var user = ET.auth && ET.auth.getUser();
    if (!c || !user) return null;
    var res = await c.from("profiles").upsert({ id: user.id, full_name: String(fullName || "") }, { onConflict: "id" });
    return res.data;
  }

  /* ------------------------ delete a single entity ---------------------- */

  async function deleteTransaction(id) {
    if (!isCloudMode()) return { ok: false };
    var c = client();
    await c.from("transactions").delete().eq("id", id);
    return { ok: true };
  }

  /* ----------------------------- public API ----------------------------- */

  ET.database = {
    isConfigured: isConfigured,
    isCloudMode: isCloudMode,
    setCloudMode: setCloudMode,
    subscribeToMutations: subscribeToMutations,
    loadAll: loadAll,
    syncAll: syncAll,
    createTransaction: createTransaction,
    localTransactionToDb: localTransactionToDb,
    dbTransactionToLocal: dbTransactionToLocal,
    ensureProfile: ensureProfile,
    fetchProfile: fetchProfile,
    updateProfileName: updateProfileName,
    fetchUserSettings: fetchUserSettings,
    createDefaultSettings: createDefaultSettings,
    updateUserSettings: updateUserSettings,
    deleteTransaction: deleteTransaction
  };
})(window);