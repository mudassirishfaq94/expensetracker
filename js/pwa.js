/* =========================================================================
   pwa.js — Progressive Web App glue (Part 13A)
   - Registers the service worker and handles safe updates.
   - Captures the browser install prompt and exposes an "Install Ledger"
     button (Settings → App).
   - Shows a subtle offline / back-online indicator.
   ========================================================================= */
(function (global) {
  "use strict";

  var ET = (global.ET = global.ET || {});

  var _deferredPrompt = null;
  var _installBtn = null;

  function getEl(id) { return document.getElementById(id); }

  /* ------------------------- service worker ----------------------------- */

  function registerSW() {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("sw.js").catch(function (err) {
      console.error("[Ledger] Service worker registration failed:", err);
    });

    /* Notify the user when a newer version of the shell is waiting. */
    navigator.serviceWorker.addEventListener("controllerchange", function () {
      try {
        if (getEl("pwa-update-bar")) getEl("pwa-update-bar").hidden = false;
      } catch (e) { /* ignore */ }
    });

    navigator.serviceWorker.ready.then(function (reg) {
      reg.addEventListener("updatefound", function () {
        var nw = reg.installing;
        if (!nw) return;
        nw.addEventListener("statechange", function () {
          if (nw.state === "installed" && navigator.serviceWorker.controller) {
            try {
              if (getEl("pwa-update-bar")) getEl("pwa-update-bar").hidden = false;
            } catch (e) { /* ignore */ }
          }
        });
      });
    });
  }

  function applyUpdate() {
    try {
      navigator.serviceWorker.getRegistration().then(function (reg) {
        if (reg && reg.waiting) reg.waiting.postMessage({ type: "SKIP_WAITING" });
      });
    } catch (e) { /* ignore */ }
    if (getEl("pwa-update-bar")) getEl("pwa-update-bar").hidden = true;
    global.setTimeout(function () { global.location.reload(); }, 250);
  }

  /* ------------------------- install prompt ----------------------------- */

  function isStandalone() {
    return global.matchMedia && global.matchMedia("(display-mode: standalone)").matches;
  }

  function syncInstallButton() {
    if (!_installBtn) return;
    var installed = isStandalone();
    var supported = !!_deferredPrompt;
    _installBtn.hidden = installed || !supported;
  }

  function capturePrompt() {
    global.addEventListener("beforeinstallprompt", function (e) {
      e.preventDefault();
      _deferredPrompt = e;
      syncInstallButton();
    });
    global.addEventListener("appinstalled", function () {
      _deferredPrompt = null;
      syncInstallButton();
      if (ET.ui && ET.ui.toast) ET.ui.toast("Ledger has been installed.");
    });
  }

  function triggerInstall() {
    if (!_deferredPrompt) return;
    _deferredPrompt.prompt();
    _deferredPrompt.userChoice.then(function (choice) {
      if (choice && choice.outcome === "dismissed") {
        /* User dismissed — don't nag again this session. */
        _deferredPrompt = null;
        syncInstallButton();
      }
    });
  }

  /* ------------------------ connection indicator ------------------------ */

  function showOffline() {
    var b = getEl("conn-banner");
    if (b) b.hidden = false;
  }
  function hideOffline() {
    var b = getEl("conn-banner");
    if (b) b.hidden = true;
  }

  function wireConnection() {
    if (global.addEventListener) {
      global.addEventListener("online", function () {
        hideOffline();
        if (ET.ui && ET.ui.toast) ET.ui.toast("You're back online.");
      });
      global.addEventListener("offline", showOffline);
    }
    if (navigator.onLine === false) showOffline();
  }

  /* ------------------------------ init ---------------------------------- */

  function init() {
    _installBtn = getEl("btn-install-pwa");
    registerSW();
    capturePrompt();
    wireConnection();
    syncInstallButton();
  }

  ET.pwa = {
    init: init,
    applyUpdate: applyUpdate,
    triggerInstall: triggerInstall,
    syncInstallButton: syncInstallButton
  };
})(window);