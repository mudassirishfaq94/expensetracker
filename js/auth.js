/* =========================================================================
   auth.js — Supabase authentication (Part 9)
   Wraps supabase-js auth into small, friendly functions used by the UI.
   Raw Supabase errors are translated into user-friendly messages.

   Attaches to: window.ET.auth
   ========================================================================= */
(function (global) {
  "use strict";

  var ET = (global.ET = global.ET || {});

  var currentUser = null;

  function client() { return ET.supabase.getClient(); }

  function isConfigured() { return ET.supabase.isConfigured(); }

  function getUser() { return currentUser; }

  function hasSession() { return !!currentUser; }

  /* --------------------------- error mapping ---------------------------- */

  function friendlyError(err) {
    if (!err) return "Something went wrong. Please try again.";
    var code = (err.code || "").toLowerCase();
    var msg = String(err.message || "").toLowerCase();
    if (code === "user_already_exists" || msg.indexOf("already registered") !== -1 || msg.indexOf("already been registered") !== -1) {
      return "An account with this email already exists. Try logging in instead.";
    }
    if (code === "invalid_credentials" || msg.indexOf("invalid login credentials") !== -1) {
      return "Incorrect email or password.";
    }
    if (msg.indexOf("email not confirmed") !== -1) {
      return "Please confirm your email address before logging in.";
    }
    if (msg.indexOf("email not confirmed") === -1 && msg.indexOf("password") !== -1 && msg.indexOf("weak") !== -1) {
      return "Password is too weak. Use at least 8 characters with a mix of letters and numbers.";
    }
    if (msg.indexOf("network") !== -1 || code === "fetch_error" || code === "network_request_failed") {
      return "Unable to reach the server. Check your internet connection and try again.";
    }
    if (code === "over_email_send_rate_limit" || msg.indexOf("rate limit") !== -1) {
      return "Too many requests. Please wait a moment and try again.";
    }
    return "Authentication failed. Please try again.";
  }

  /* ------------------------------ helpers ------------------------------- */

  function validateEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || "").trim());
  }

  function validatePassword(password) {
    var p = String(password || "");
    if (p.length < 8) return "Password must be at least 8 characters.";
    if (!/[a-zA-Z]/.test(p) || !/\d/.test(p)) return "Password must contain letters and numbers.";
    return null;
  }

  function setUser(user) {
    currentUser = user || null;
    if (ET.database) ET.database.setCloudMode(!!user);
    return currentUser;
  }

  /* ------------------------------- actions ------------------------------ */

  async function signUp(input) {
    var c = client();
    if (!c) return { error: "Cloud sync is unavailable. Try again in a moment." };
    var email = String(input.email || "").trim();
    var fullName = String(input.fullName || "").trim();
    var password = String(input.password || "");
    if (!email || !validateEmail(email)) return { error: "Enter a valid email address." };
    if (!fullName) return { error: "Enter your full name." };
    var pwErr = validatePassword(password);
    if (pwErr) return { error: pwErr };
    var result = await c.auth.signUp({
      email: email,
      password: password,
      options: { data: { full_name: fullName } }
    });
    if (result.error) return { error: friendlyError(result.error) };
    if (result.data && result.data.session) setUser(result.data.session.user);
    return { user: result.data && result.data.user ? result.data.user : null, requiresEmailConfirmation: !!(result.data && !result.data.session) };
  }

  async function signIn(email, password) {
    var c = client();
    if (!c) return { error: "Cloud sync is unavailable. Try again in a moment." };
    if (!email || !String(email).trim()) return { error: "Enter your email address." };
    if (!password) return { error: "Enter your password." };
    var result = await c.auth.signInWithPassword({ email: String(email).trim(), password: String(password) });
    if (result.error) return { error: friendlyError(result.error) };
    setUser(result.data.user);
    return { user: result.data.user };
  }

  async function signOut() {
    var c = client();
    setUser(null);
    if (c) {
      var result = await c.auth.signOut();
      if (result.error) return { error: friendlyError(result.error) };
    }
    return { ok: true };
  }

  async function resetPassword(email) {
    var c = client();
    if (!c) return { error: "Cloud sync is unavailable. Try again in a moment." };
    if (!validateEmail(String(email || "").trim())) return { error: "Enter a valid email address." };
    var result = await c.auth.resetPasswordForEmail(String(email).trim(), {
      redirectTo: global.location ? global.location.origin + global.location.pathname : undefined
    });
    if (result.error) return { error: friendlyError(result.error) };
    return { ok: true };
  }

  async function updatePassword(newPassword) {
    var c = client();
    if (!c) return { error: "Cloud sync is unavailable. Try again in a moment." };
    var pwErr = validatePassword(newPassword);
    if (pwErr) return { error: pwErr };
    var result = await c.auth.updateUser({ password: String(newPassword) });
    if (result.error) return { error: friendlyError(result.error) };
    setUser(result.data.user || currentUser);
    return { ok: true };
  }

  /* ------------------------------ session ------------------------------- */

  async function restoreSession() {
    var c = client();
    if (!c) return null;
    try {
      var res = await c.auth.getSession();
      if (res.data && res.data.session && res.data.session.user) {
        setUser(res.data.session.user);
        return res.data.session.user;
      }
    } catch (e) { /* ignore */ }
    return null;
  }

  function onAuthStateChange(cb) {
    var c = client();
    if (!c || typeof cb !== "function") return null;
    var sub = c.auth.onAuthStateChange(function (event, session) {
      setUser(session && session.user ? session.user : null);
      cb(event, session);
    });
    return sub && sub.data ? sub.data : sub;
  }

  /* ----------------------------- public API ----------------------------- */

  ET.auth = {
    isConfigured: isConfigured,
    getUser: getUser,
    hasSession: hasSession,
    signUp: signUp,
    signIn: signIn,
    signOut: signOut,
    resetPassword: resetPassword,
    updatePassword: updatePassword,
    restoreSession: restoreSession,
    onAuthStateChange: onAuthStateChange,
    friendlyError: friendlyError,
    validateEmail: validateEmail
  };
})(window);
