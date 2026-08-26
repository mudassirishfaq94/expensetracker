/* =========================================================================
   settings.js — Central user settings state
   Single source of truth for user preferences (currency, theme, etc.).
   All application components read the active currency from this module.
   ========================================================================= */
(function (global) {
  "use strict";

  var ET = (global.ET = global.ET || {});

  var state = {
    currency: "AED",
    theme: "light",
    date_format: "dd mmm yyyy",
    timezone: "UTC"
  };

  function getCurrency() { return state.currency || "AED"; }

  function getTheme() { return state.theme || "light"; }

  function getDateFormat() { return state.date_format || "dd mmm yyyy"; }

  /**
   * Central currency formatter.
   * Every financial display in the app should use this function.
   */
  function formatCurrency(amount) {
    return formatCurrencyFor(amount, getCurrency());
  }

  /**
   * Format an amount using an explicit currency code.
   * Used for individual transactions that carry their own stored currency,
   * e.g. a 100 AED transaction must stay distinguishable from a $50 USD one.
   */
  function formatCurrencyFor(amount, currency) {
    var n = Number(amount) || 0;
    var curr = String(currency || getCurrency());
    try {
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: curr,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      }).format(n);
    } catch (e) {
      return curr + " " + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
  }

  /**
   * Signed variant used for income (+) / expense (−) displays.
   */
  function signedCurrencyFor(amount, type, currency) {
    var abs = Math.abs(Number(amount) || 0);
    if (type === "income") return "+ " + formatCurrencyFor(abs, currency);
    return "\u2212 " + formatCurrencyFor(abs, currency);
  }

  /**
   * Load user settings from Supabase and populate central state.
   * Creates default settings if none exist for the user.
   */
  async function load() {
    if (!ET.database || !ET.auth || !ET.auth.hasSession()) {
      state.currency = "AED";
      return state;
    }
    try {
      var settings = await ET.database.fetchUserSettings();
      if (settings) {
        state.currency = settings.currency || "AED";
        state.theme = settings.theme || "light";
        state.date_format = settings.date_format || "dd mmm yyyy";
        state.timezone = settings.timezone || "UTC";
      } else {
        await ET.database.createDefaultSettings();
        state.currency = "AED";
        state.theme = "light";
        state.date_format = "dd mmm yyyy";
        state.timezone = "UTC";
      }
    } catch (err) {
      console.error("[Ledger] Could not load user settings:", err);
      state.currency = "AED";
    }
    return state;
  }

  /**
   * Update the default currency.
   * Saves to Supabase, updates in-memory state immediately.
   * On failure, reverts to the previous value.
   */
  async function saveCurrency(newCurrency) {
    var old = state.currency;
    state.currency = newCurrency;
    try {
      await ET.database.updateUserSettings({
        currency: newCurrency,
        updated_at: new Date().toISOString()
      });
      return true;
    } catch (err) {
      console.error("[Ledger] Could not save currency setting:", err);
      state.currency = old;
      throw err;
    }
  }

  /**
   * Get the default currency for new forms (transactions, budgets, goals, recurring).
   */
  function getDefaultCurrency() {
    return getCurrency();
  }

  ET.settings = {
    state: state,
    getCurrency: getCurrency,
    getTheme: getTheme,
    getDateFormat: getDateFormat,
    formatCurrency: formatCurrency,
    formatCurrencyFor: formatCurrencyFor,
    signedCurrencyFor: signedCurrencyFor,
    load: load,
    saveCurrency: saveCurrency,
    getDefaultCurrency: getDefaultCurrency
  };
})(window);