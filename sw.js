/* =========================================================================
   sw.js — Ledger Expense service worker (PWA)
   Safe caching strategy:
     - Precache the application shell (HTML, CSS, JS, icons, images).
     - Navigation (HTML) is network-first so new deployments are picked up,
       falling back to the cached shell when offline.
     - Static assets are stale-while-revalidate: served instantly from cache,
       refreshed in the background.
     - Supabase API responses and any cross-origin data are NEVER cached —
       authenticated financial data always comes from the network.
     - All paths are relative to the service worker scope, so the app works
       at any host root or subdirectory (Hostinger subdomain, GitHub Pages…).
   ========================================================================= */

const VERSION = "ledger-v2";
const SHELL_CACHE = VERSION + "-shell";

const SHELL_ASSETS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./css/style.css",
  "./js/storage.js",
  "./js/transactions.js",
  "./js/expenses.js",
  "./js/parser.js",
  "./js/googleSheets.js",
  "./js/reports.js",
  "./js/budgets.js",
  "./js/recurring.js",
  "./js/data.js",
  "./js/supabase-config.js",
  "./js/supabase.js",
  "./js/auth.js",
  "./js/database.js",
  "./js/settings.js",
  "./js/notifications.js",
  "./js/pwa.js",
  "./js/migration.js",
  "./js/ui.js",
  "./js/app.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-192.png",
  "./icons/icon-maskable-512.png",
  "./icons/apple-touch-icon.png",
  "./icons/favicon-32.png",
  "./icons/favicon-16.png",
  "./images/logo.png",
  "./images/sitelogo.png"
];

/* Scope-relative prefix, e.g. "/" at a host root or "/expensetracker/" in a subdir. */
const SCOPE_PATH = new URL("./", self.registration.scope).pathname;
const INDEX_URL = new URL("index.html", self.registration.scope).href;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  /* Never intercept Supabase API / auth traffic or any other origin. */
  if (url.origin !== self.location.origin) return;
  if (!url.pathname.startsWith(SCOPE_PATH)) return;
  if (url.pathname.includes("/rest/v1/") || url.pathname.includes("/auth/")) return;

  /* Non-GET (writes) pass through untouched. */
  if (req.method !== "GET") return;

  /* Navigation (HTML pages): network-first with cached-shell fallback. */
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(SHELL_CACHE).then((cache) => cache.put(INDEX_URL, copy));
          return res;
        })
        .catch(() => caches.match(INDEX_URL))
    );
    return;
  }

  /* Static assets: stale-while-revalidate. */
  const isAsset =
    url.pathname.startsWith(SCOPE_PATH + "css/") ||
    url.pathname.startsWith(SCOPE_PATH + "js/") ||
    url.pathname.startsWith(SCOPE_PATH + "icons/") ||
    url.pathname.startsWith(SCOPE_PATH + "images/") ||
    url.pathname.endsWith(".webmanifest");
  if (isAsset) {
    event.respondWith(
      caches.match(req).then((cached) => {
        const fetchPromise = fetch(req)
          .then((res) => {
            if (res && res.ok) {
              const copy = res.clone();
              caches.open(SHELL_CACHE).then((cache) => cache.put(req, copy));
            }
            return res;
          })
          .catch(() => cached);
        return cached || fetchPromise;
      })
    );
    return;
  }
});
