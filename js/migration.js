/* =========================================================================
   migration.js — LocalStorage → Supabase migration (Part 9)
   Scans existing LocalStorage data, shows a preview, and uploads it to the
   authenticated user's Supabase account. Idempotent: re-running skips
   records that already exist in Supabase (matched by PK id).  Relationships
   (goals → contributions) are preserved because the same local ids are used.

   After a successful migration the app switches to cloud mode and all future
   writes go through the database sync layer.

   Attaches to: window.ET.migration
   ========================================================================= */
(function (global) {
  "use strict";

  var ET = (global.ET = global.ET || {});

  var MIGRATION_KEY = "et_migration_v1";

  /* ------------------------------ tracking ------------------------------ */

  function loadMeta() {
    try {
      var raw = global.localStorage ? global.localStorage.getItem(MIGRATION_KEY) : null;
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function saveMeta(meta) {
    try {
      global.localStorage.setItem(MIGRATION_KEY, JSON.stringify(meta || {}));
    } catch (e) { /* ignore */ }
  }

  function isComplete() {
    var m = loadMeta();
    return m && m.status === "complete";
  }

  function isPending() {
    var m = loadMeta();
    return m && m.status === "pending";
  }

  function isSkipped() {
    var m = loadMeta();
    return m && m.status === "skipped";
  }

  /* --------------------------- local data check ------------------------- */

  function hasLocalData() {
    var tx = (ET.transactions && ET.transactions.all()) || [];
    var goals = (ET.budgets && ET.budgets.getGoals()) || [];
    var rec = (ET.recurring && ET.recurring.getRecurring()) || [];
    var cfg = (ET.budgets && ET.budgets.getBudgetsConfig()) || {};
    var hasTx = tx.length > 0;
    var hasGoal = goals.length > 0;
    var hasRec = rec.length > 0;
    var hasBudget = cfg.monthly > 0 || (cfg.categories && Object.keys(cfg.categories).length > 0);
    return hasTx || hasGoal || hasRec || hasBudget;
  }

  function preview() {
    var tx = (ET.transactions && ET.transactions.all()) || [];
    var goals = (ET.budgets && ET.budgets.getGoals()) || [];
    var rec = (ET.recurring && ET.recurring.getRecurring()) || [];
    var cfg = (ET.budgets && ET.budgets.getBudgetsConfig()) || {};
    var contributions = 0;
    goals.forEach(function (g) { contributions += (g.contributions || []).length; });
    var budgetCount = (cfg.monthly > 0 ? 1 : 0) + (cfg.categories ? Object.keys(cfg.categories).length : 0);
    return {
      transactions: tx.length,
      budgets: budgetCount,
      financialGoals: goals.length,
      goalContributions: contributions,
      recurringTransactions: rec.length
    };
  }

  /* -------------------------------- check ------------------------------- */

  /**
   * Called during app init. Returns:
   *   false  → no migration needed (no data, or already migrated)
   *   true   → show migration screen
   *   "skip" → user previously skipped; optionally show a hint
   */
  function runCheck() {
    if (isComplete()) return false;
    if (!hasLocalData()) {
      /* Nothing to migrate — mark complete so we never check again. */
      saveMeta({ status: "complete", migratedAt: null, note: "no-local-data" });
      return false;
    }
    if (!isSkipped()) return true;
    return "skipped";
  }

  /* ------------------------------ migrate ------------------------------- */

  async function migrate() {
    if (!ET.database || !ET.database.syncAll) return { ok: false, error: "Database layer not available." };
    if (!ET.auth || !ET.auth.hasSession()) return { ok: false, error: "Not authenticated." };
    saveMeta({ status: "pending", startedAt: Date.now() });

    try {
      var result = await ET.database.syncAll();
      if (!result.ok) throw new Error(result.reason || "syncAll failed");

      /* Verify by checking counts */
      var verify = preview();
      saveMeta({ status: "complete", migratedAt: Date.now(), verified: verify });
      return { ok: true, preview: verify };
    } catch (err) {
      saveMeta({ status: "error", lastError: (err && err.message) || "Migration failed", attemptedAt: Date.now() });
      return { ok: false, error: (err && err.message) || "Migration could not be completed. Your existing local data is still safe." };
    }
  }

  /* ----------------------------- public API ----------------------------- */

  ET.migration = {
    isComplete: isComplete,
    isPending: isPending,
    isSkipped: isSkipped,
    hasLocalData: hasLocalData,
    preview: preview,
    runCheck: runCheck,
    migrate: migrate,
    saveMeta: saveMeta,
    loadMeta: loadMeta
  };
})(window);