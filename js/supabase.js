/* =========================================================================
   supabase.js — Supabase client setup (Part 9)
   Reads config from js/supabase-config.js (window.SUPABASE_CONFIG) and creates
   a single supabase-js client. Also supports credentials supplied through
   SUPABASE_URL / SUPABASE_ANON_KEY when the app is built/served with env vars.

   If no configuration is present the app simply runs in LocalStorage mode —
   nothing here throws.

   Attaches to: window.ET.supabase
   ========================================================================= */
(function (global) {
  "use strict";

  var ET = (global.ET = global.ET || {});

  var config = {
    url: "",
    anonKey: ""
  };

  function readConfig() {
    var cfg = (global.SUPABASE_CONFIG || {}) || {};
    var envUrl = typeof process !== "undefined" && process.env ? process.env.SUPABASE_URL : null;
    var envKey = typeof process !== "undefined" && process.env ? process.env.SUPABASE_ANON_KEY : null;
    config.url = String(cfg.url || envUrl || "").trim();
    config.anonKey = String(cfg.anonKey || envKey || "").trim();
  }

  function isConfigured() {
    return !!(config.url && config.anonKey);
  }

  function getConfig() {
    return { url: config.url, anonKey: config.anonKey };
  }

  /* Initialise the client if configured. Must be called before auth/database. */
  function init() {
    readConfig();
    ET.supabase.client = null;
    if (isConfigured()) {
      var create = (global.supabase && global.supabase.createClient);
      if (typeof create === "function") {
        ET.supabase.client = create(config.url, config.anonKey, {
          auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: true
          }
        });
      } else {
        console.warn("[Ledger] supabase-js is not loaded (script not present).");
      }
    }
    return ET.supabase.client;
  }

  function getClient() {
    return ET.supabase.client || null;
  }

  ET.supabase = {
    config: config,
    readConfig: readConfig,
    getConfig: getConfig,
    isConfigured: isConfigured,
    init: init,
    getClient: getClient
  };
})(window);
