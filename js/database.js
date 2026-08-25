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
      /* Transactions */
      var txRes = await c.from("transactions").select("*").eq("user_id", user.id).order("created_at", { ascending: false });
      if (txRes.error) throw txRes.error;
      storage.replaceAllTransactions(txRes.data || []);

      /* Budgets */
      var bRes = await c.from("budgets").select("*").eq("user_id", user.id).maybeSingle();
      var catBRes = await c.from("category_budgets").select("*").eq("user_id", user.id);
      var monthly = (bRes.data && bRes.data.monthly_budget) || 0;
      var cats = {};
      (catBRes.data || []).forEach(function (r) { cats[r.category] = r.amount; });
      storage.saveBudgetsConfig({ monthly: monthly, categories: cats });

      /* Goals */
      var gRes = await c.from("financial_goals").select("*").eq("user_id", user.id);
      var gcRes = await c.from("goal_contributions").select("*").eq("user_id", user.id);
      var goals = (gRes.data || []).map(function (g) {
        g.contributions = (gcRes.data || []).filter(function (gc) { return gc.goal_id === g.id; });
        return g;
      });
      storage.saveGoals(goals);

      /* Recurring */
      var rRes = await c.from("recurring_transactions").select("*").eq("user_id", user.id);
      storage.saveRecurring(rRes.data || []);

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
      /* Transactions */
      var txs = ET.transactions ? ET.transactions.all() : [];
      if (txs.length) {
        var withUserId = txs.map(function (t) { return Object.assign({}, t, { user_id: user.id }); });
        await c.from("transactions").upsert(withUserId, { onConflict: "id", ignoreDuplicates: false });
      }

      /* Budgets */
      var cfg = ET.budgets ? ET.budgets.getBudgetsConfig() : { monthly: 0, categories: {} };
      await c.from("budgets").upsert({ user_id: user.id, monthly_budget: cfg.monthly || 0, currency: "AED" }, { onConflict: "user_id" });
      var catBuds = Object.keys(cfg.categories || {}).map(function (cat) {
        return { id: "cb_" + user.id + "_" + cat, user_id: user.id, category: cat, amount: cfg.categories[cat] || 0, currency: "AED" };
      });
      if (catBuds.length) {
        await c.from("category_budgets").upsert(catBuds, { onConflict: "id" });
      }

      /* Goals */
      var goals = ET.budgets ? ET.budgets.getGoals() : [];
      var goalLines = goals.map(function (g) {
        return { id: g.id, user_id: user.id, title: g.title || "", target_amount: g.target || 0, currency: "AED", target_date: g.deadline || null };
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
          currency: "AED", category: r.category || "", vendor_source: r.vendor || "", notes: r.notes || "",
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

  async function fetchUserSettings() {
    var c = client();
    var user = ET.auth && ET.auth.getUser();
    if (!c || !user) return null;
    var res = await c.from("user_settings").select("*").eq("user_id", user.id).maybeSingle();
    return res.data || null;
  }

  async function updateUserSettings(settings) {
    var c = client();
    var user = ET.auth && ET.auth.getUser();
    if (!c || !user) return null;
    var res = await c.from("user_settings").upsert(Object.assign({ user_id: user.id }, settings), { onConflict: "user_id" });
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
    ensureProfile: ensureProfile,
    fetchProfile: fetchProfile,
    updateProfileName: updateProfileName,
    fetchUserSettings: fetchUserSettings,
    updateUserSettings: updateUserSettings,
    deleteTransaction: deleteTransaction
  };
})(window);