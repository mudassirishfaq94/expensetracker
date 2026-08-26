/* =========================================================================
   notifications.js — Smart Notifications & Alerts (Part 10)
   Central notification data layer, alert engine, and notification center UI.
   Every notification is persisted in Supabase, user-specific, and
   deduplicated.
   ========================================================================= */
(function (global) {
  "use strict";

  var ET = (global.ET = global.ET || {});
  var storage = ET.storage;

  function client() { return ET.supabase && ET.supabase.getClient(); }

  function isCloud() { return ET.database && ET.database.isCloudMode(); }

  function currentUser() { return ET.auth && ET.auth.getUser(); }

  var MAX_NOTIFICATIONS = 100;

  /* --------------------------- dedupe key helpers ----------------------- */

  function monthKey() {
    var d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
  }

  function dayKey() {
    var d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  function dedupeKeyFor(type, parts) {
    return type + ":" + parts.join(":");
  }

  /* --------------------------- data layer ------------------------------- */

  /**
   * Fetch recent notifications for the current user.
   */
  async function fetchNotifications() {
    var c = client();
    var user = currentUser();
    if (!c || !user) return [];
    var res = await c.from("notifications")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(MAX_NOTIFICATIONS);
    if (res.error) {
      console.error("[Ledger] Could not load notifications:", res.error);
      return [];
    }
    return res.data || [];
  }

  /**
   * Insert a notification.  Never throws — failures are logged and the
   * main action (transaction save, etc.) is never disturbed.
   */
  async function createNotification(opts) {
    var c = client();
    var user = currentUser();
    if (!c || !user) return null;
    var row = {
      user_id: user.id,
      type: opts.type || "system",
      title: String(opts.title || ""),
      message: String(opts.message || ""),
      severity: opts.severity || "info",
      related_entity_type: opts.relatedEntityType || null,
      related_entity_id: opts.relatedEntityId || null,
      dedupe_key: opts.dedupeKey || null,
      is_read: false
    };
    try {
      var res = await c.from("notifications").insert([row]).select().single();
      if (res.error) throw res.error;
      return res.data;
    } catch (err) {
      console.error("[Ledger] Could not create notification:", err);
      return null;
    }
  }

  async function markAsRead(id) {
    var c = client();
    if (!c) return;
    try {
      await c.from("notifications").update({ is_read: true, updated_at: new Date().toISOString() }).eq("id", id);
    } catch (err) {
      console.error("[Ledger] Could not mark notification as read:", err);
    }
  }

  async function markAllAsRead() {
    var c = client();
    var user = currentUser();
    if (!c || !user) return;
    try {
      await c.from("notifications").update({ is_read: true, updated_at: new Date().toISOString() }).eq("user_id", user.id).eq("is_read", false);
    } catch (err) {
      console.error("[Ledger] Could not mark all as read:", err);
    }
  }

  async function deleteNotification(id) {
    var c = client();
    var user = currentUser();
    if (!c || !user) return;
    try {
      await c.from("notifications").delete().eq("id", id).eq("user_id", user.id);
    } catch (err) {
      console.error("[Ledger] Could not delete notification:", err);
    }
  }

  async function clearReadNotifications() {
    var c = client();
    var user = currentUser();
    if (!c || !user) return;
    try {
      await c.from("notifications").delete().eq("user_id", user.id).eq("is_read", true);
    } catch (err) {
      console.error("[Ledger] Could not clear read notifications:", err);
    }
  }

  /**
   * Get the set of existing dedupe_keys for the current user (recent 300).
   * Used by the engine to avoid duplicates.
   */
  async function fetchExistingDedupeKeys() {
    var c = client();
    var user = currentUser();
    if (!c || !user) return new Set();
    var res = await c.from("notifications")
      .select("dedupe_key")
      .eq("user_id", user.id)
      .not("dedupe_key", "is", null)
      .limit(300);
    if (res.error) return new Set();
    var keys = new Set();
    (res.data || []).forEach(function (r) { if (r.dedupe_key) keys.add(r.dedupe_key); });
    return keys;
  }

  /* --------------------------- alert engine ----------------------------- */

  /**
   * Central financial alert check.  Evaluates budgets, recurring payments,
   * subscriptions, and goal milestones.  Creates deduplicated notifications
   * in Supabase.
   *
   * Returns the number of newly created notifications.
   */
  var _checkInFlight = false;
  async function checkFinancialAlerts() {
    if (!isCloud()) return 0;
    /* Prevent concurrent checks from racing the dedupe lookup and inserting
       the same notification twice. */
    if (_checkInFlight) return 0;
    _checkInFlight = true;
    try {
      return await runCheck();
    } finally {
      _checkInFlight = false;
    }
  }

  async function runCheck() {
    var existingKeys = await fetchExistingDedupeKeys();
    var created = 0;
    var pendingCreates = [];

    var transactions = ET.transactions ? ET.transactions.all() : [];
    var budgetCfg = ET.budgets ? ET.budgets.getBudgetsConfig() : { monthly: 0, categories: {} };
    var recurringDefs = ET.recurring ? ET.recurring.getRecurring() : [];
    var goals = ET.budgets ? ET.budgets.getGoals() : [];
    var mk = monthKey();

    /* ------------------------ budget checks ---------------------------- */
    if (budgetCfg.monthly > 0) {
      var st = ET.budgets ? ET.budgets.budgetStatus(transactions) : null;
      if (st && st.hasMonthlyBudget) {
        var pct = st.monthly.pct;
        created += checkBudgetThresholdSync("monthly", null, pct, st.monthly, existingKeys, mk);
      }
    }
    if (budgetCfg.categories && Object.keys(budgetCfg.categories).length > 0 && ET.budgets) {
      var catSt = ET.budgets.budgetStatus(transactions);
      if (catSt && catSt.hasCategoryBudgets) {
        Object.keys(catSt.categories).forEach(function (cat) {
          var info = catSt.categories[cat];
          if (info.budget > 0) {
            created += checkBudgetThresholdSync("cat", cat, info.pct, info, existingKeys, mk);
          }
        });
      }
    }

    /* -------------------- recurring / subscription checks -------------- */
    recurringDefs.forEach(function (def) {
      if (def.status !== "active") return;
      if (!def.nextDueDate) return;
      var due = parseDate(def.nextDueDate);
      if (!due) return;
      var diffDays = Math.round((due - startOfToday()) / 86400000);

      if (def.isSubscription) {
        /* subscription reminder (7, 3, 1, 0 days before) */
        var subWindows = [7, 3, 1, 0];
        subWindows.forEach(function (w) {
          if (diffDays === w) {
            var key = dedupeKeyFor("subscription", [def.id, def.nextDueDate, String(w)]);
            if (!existingKeys.has(key)) {
              existingKeys.add(key);
              var title = def.title || "Subscription";
              var msg = title + " — " + formatCurrencyFor(def.amount, def.currency) + " is due " + (w === 0 ? "today" : "in " + w + " day" + (w > 1 ? "s" : ""));
              attemptCreate({ type: "subscription_reminder", title: title + " due soon", message: msg, severity: "warning", relatedEntityType: "recurring", relatedEntityId: def.id, dedupeKey: key });
              created++;
            }
          }
        });
        return; /* skip generic upcoming for subscriptions */
      }

      /* upcoming payment (7, 3, 1, 0 days before) */
      var upWindows = [7, 3, 1, 0];
      upWindows.forEach(function (w) {
        if (diffDays === w) {
          var key = dedupeKeyFor("upcoming", [def.id, def.nextDueDate, String(w)]);
          if (!existingKeys.has(key)) {
            existingKeys.add(key);
            var title = def.title || "Payment";
            var msg = title + " of " + formatCurrencyFor(def.amount, def.currency) + " is due " + (w === 0 ? "today" : "in " + w + " day" + (w > 1 ? "s" : ""));
            attemptCreate({ type: "upcoming_payment", title: "Upcoming payment", message: msg, severity: "warning", relatedEntityType: "recurring", relatedEntityId: def.id, dedupeKey: key });
            created++;
          }
        }
      });

      /* overdue */
      if (diffDays < 0) {
        var key = dedupeKeyFor("overdue", [def.id, def.nextDueDate]);
        if (!existingKeys.has(key)) {
          existingKeys.add(key);
          var title = def.title || "Payment";
          var msg = title + " of " + formatCurrencyFor(def.amount, def.currency) + " was due on " + formatDate(def.nextDueDate) + ".";
          attemptCreate({ type: "overdue_payment", title: "Payment overdue", message: msg, severity: "critical", relatedEntityType: "recurring", relatedEntityId: def.id, dedupeKey: key });
          created++;
        }
      }
    });

    /* ------------------------ goal checks ------------------------------- */
    goals.forEach(function (goal) {
      var prog = ET.budgets.computeGoalProgress(goal);
      var pct = prog.pct;
      var milestones = [25, 50, 75];
      milestones.forEach(function (m) {
        if (pct >= m) {
          var key = dedupeKeyFor("goal", [goal.id, "progress", String(m)]);
          if (!existingKeys.has(key)) {
            existingKeys.add(key);
            var msg = "You're " + m + "% of the way to your " + (goal.name || "goal") + " goal.";
            attemptCreate({ type: "goal_progress", title: "Goal progress", message: msg, severity: "info", relatedEntityType: "goal", relatedEntityId: goal.id, dedupeKey: key });
            created++;
          }
        }
      });
      if (prog.completed) {
        var key = dedupeKeyFor("goal", [goal.id, "completed"]);
        if (!existingKeys.has(key)) {
          existingKeys.add(key);
          var msg = "You've reached your " + (goal.name || "goal") + " goal!";
          attemptCreate({ type: "goal_completed", title: "Goal completed", message: msg, severity: "success", relatedEntityType: "goal", relatedEntityId: goal.id, dedupeKey: key });
          created++;
        }
      }
    });

    await Promise.all(pendingCreates);
    return created;

    /* ----- helpers ----- */
    function checkBudgetThresholdSync(scope, identifier, pct, info, keys, mk) {
      var reached = Number(info.budget) > 0 && Number(info.spent) >= Number(info.budget);
      var exceeded = !!(info.exceeded);
      if (exceeded) {
        return checkOne("budget_exceeded", scope, identifier, "exceeded", "critical", info, keys, mk, "exceeded");
      }
      if (reached) {
        return checkOne("budget_exceeded", scope, identifier, "reached", "critical", info, keys, mk, "reached");
      }
      if (pct >= 90) {
        return checkOne("budget_warning", scope, identifier, "90", "warning", info, keys, mk, "90");
      }
      if (pct >= 75) {
        return checkOne("budget_warning", scope, identifier, "75", "warning", info, keys, mk, "75");
      }
      return 0;
    }

    function checkOne(type, scope, identifier, threshold, sev, info, keys, mk, bucket) {
      var keyParts = scope === "monthly" ? [mk, bucket] : [identifier, mk, bucket];
      var key = dedupeKeyFor(type === "budget_exceeded" ? "budget:exceeded" : "budget:warning", keyParts);
      if (keys.has(key)) return 0;
      keys.add(key);
      var title, msg;
      var currency = ET.settings ? ET.settings.getCurrency() : "AED";
      if (scope === "monthly") {
        if (type === "budget_exceeded") {
          title = "Budget exceeded";
          msg = bucket === "reached"
            ? "You've reached your monthly budget limit."
            : "You've exceeded your monthly budget by " + formatCurrencyFor(info.exceededBy, currency) + ".";
        } else {
          title = "Budget warning";
          msg = "You've used " + threshold + "% of your monthly budget.";
        }
      } else {
        if (type === "budget_exceeded") {
          title = "Budget exceeded";
          msg = bucket === "reached"
            ? "Your " + identifier + " budget has reached its monthly limit."
            : "Your " + identifier + " budget has been exceeded by " + formatCurrencyFor(info.exceededBy, currency) + ".";
        } else {
          title = "Budget warning";
          msg = "Your " + identifier + " budget is " + threshold + "% used.";
        }
      }
      pendingCreates.push(createNotification({ type: type === "budget_exceeded" ? "budget_exceeded" : "budget_warning", title: title, message: msg, severity: sev, relatedEntityType: scope === "monthly" ? "monthly_budget" : "category_budget", relatedEntityId: scope === "monthly" ? null : identifier, dedupeKey: key }));
      return 1;
    }

    function attemptCreate(opts) {
      pendingCreates.push(createNotification(opts));
    }

    function startOfToday() {
      var d = new Date();
      d.setHours(0, 0, 0, 0);
      return d;
    }

    function parseDate(s) {
      if (!s || typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
      var p = s.split("-");
      var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
      if (isNaN(d.getTime())) return null;
      return d;
    }

    function formatDate(dateStr) {
      if (!dateStr) return "";
      var parts = dateStr.split("-");
      if (parts.length !== 3) return dateStr;
      var d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
      var months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
      return d.getDate() + " " + months[d.getMonth()] + " " + d.getFullYear();
    }

    function formatCurrencyFor(amount, currency) {
      if (ET.settings && ET.settings.formatCurrencyFor) {
        return ET.settings.formatCurrencyFor(amount, currency);
      }
      var n = Number(amount) || 0;
      var curr = currency || "AED";
      return curr + " " + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
  }

  /* --------------------------- UI rendering ----------------------------- */

  var _notificationsData = [];
  var _panelOpen = false;

  function getEl(id) { return document.getElementById(id); }

  /**
   * Load notifications from Supabase, cache in memory, render badge.
   */
  async function load() {
    _notificationsData = await fetchNotifications();
    renderBadge();
    return _notificationsData;
  }

  function renderBadge() {
    var badges = [];
    var badge = getEl("notif-badge");
    var badgeMobile = getEl("notif-badge-mobile");
    if (badge) badges.push(badge);
    if (badgeMobile) badges.push(badgeMobile);
    var count = 0;
    _notificationsData.forEach(function (n) { if (!n.is_read) count++; });
    badges.forEach(function (b) {
      b.hidden = count === 0;
      b.textContent = count > 99 ? "99+" : String(count);
    });
  }

  /**
   * Render the notification panel.
   */
  function renderPanel() {
    var list = getEl("notif-list");
    var empty = getEl("notif-empty");
    if (!list || !empty) return;
    if (!_notificationsData.length) {
      list.innerHTML = "";
      empty.hidden = false;
      return;
    }
    empty.hidden = true;
    list.innerHTML = _notificationsData.map(function (n) {
      var sevClass = n.severity || "info";
      var readClass = n.is_read ? "is-read" : "is-unread";
      var timeAgo = ET.ui && ET.ui.formatRelativeTime ? ET.ui.formatRelativeTime(n.created_at) : (n.created_at || "");
      return (
        '<div class="notif-item ' + readClass + '" data-nid="' + n.id + '" data-severity="' + sevClass + '">' +
          '<div class="notif-sev ' + sevClass + '" title="' + sevClass + '"></div>' +
          '<div class="notif-body">' +
            '<div class="notif-title">' + esc(n.title) + '</div>' +
            '<div class="notif-msg">' + esc(n.message) + '</div>' +
            '<div class="notif-time">' + esc(timeAgo) + '</div>' +
          '</div>' +
          '<button class="notif-del" type="button" data-del-nid="' + n.id + '" aria-label="Delete notification">' +
            '<svg viewBox="0 0 24 24" width="14" height="14"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>' +
          '</button>' +
        '</div>'
      );
    }).join("");
  }

  function esc(str) {
    if (str == null) return "";
    return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function togglePanel() {
    _panelOpen = !_panelOpen;
    var panel = getEl("notif-panel");
    var btn = getEl("btn-notif");
    var btnMobile = getEl("btn-notif-mobile");
    if (!panel) return;
    if (_panelOpen) {
      panel.hidden = false;
      renderPanel();
      if (btn) btn.setAttribute("aria-expanded", "true");
      if (btnMobile) btnMobile.setAttribute("aria-expanded", "true");
    } else {
      panel.hidden = true;
      if (btn) btn.setAttribute("aria-expanded", "false");
      if (btnMobile) btnMobile.setAttribute("aria-expanded", "false");
    }
  }

  function closePanel() {
    if (!_panelOpen) return;
    _panelOpen = false;
    var panel = getEl("notif-panel");
    var btn = getEl("btn-notif");
    var btnMobile = getEl("btn-notif-mobile");
    if (panel) panel.hidden = true;
    if (btn) btn.setAttribute("aria-expanded", "false");
    if (btnMobile) btnMobile.setAttribute("aria-expanded", "false");
  }

  /**
   * Refresh data and badge (e.g., after marking read).
   */
  async function refresh() {
    await load();
    if (_panelOpen) renderPanel();
  }

  /* --------------------------- event wiring ----------------------------- */

  function wire() {
    var btn = getEl("btn-notif");
    var btnMobile = getEl("btn-notif-mobile");
    var panel = getEl("notif-panel");
    var list = getEl("notif-list");
    var markAllBtn = getEl("btn-mark-all-read");
    var clearBtn = getEl("btn-clear-read");

    if (btn) btn.addEventListener("click", function (e) { e.stopPropagation(); togglePanel(); });
    if (btnMobile) btnMobile.addEventListener("click", function (e) { e.stopPropagation(); togglePanel(); });

    /* click on notification item: mark as read */
    if (list) list.addEventListener("click", function (e) {
      var delBtn = e.target.closest("[data-del-nid]");
      if (delBtn) {
        var nid = delBtn.getAttribute("data-del-nid");
        e.stopPropagation();
        deleteNotification(nid).then(function () {
          _notificationsData = _notificationsData.filter(function (n) { return n.id !== nid; });
          renderPanel();
          renderBadge();
        });
        return;
      }
      var item = e.target.closest(".notif-item");
      if (!item) return;
      var id = item.getAttribute("data-nid");
      if (!id) return;
      if (!item.classList.contains("is-read")) {
        markAsRead(id).then(function () {
          _notificationsData.forEach(function (n) { if (n.id === id) n.is_read = true; });
          renderBadge();
          renderPanel();
        });
      }
    });

    if (markAllBtn) markAllBtn.addEventListener("click", function () {
      markAllAsRead().then(function () {
        _notificationsData.forEach(function (n) { n.is_read = true; });
        renderBadge();
        renderPanel();
      });
    });

    if (clearBtn) clearBtn.addEventListener("click", function () {
      clearReadNotifications().then(function () {
        _notificationsData = _notificationsData.filter(function (n) { return !n.is_read; });
        renderBadge();
        renderPanel();
      });
    });

    /* close panel on outside click */
    document.addEventListener("click", function (e) {
      if (!_panelOpen) return;
      var wrap = getEl("notif-wrap");
      if (wrap && !wrap.contains(e.target)) closePanel();
    });

    /* close panel on Escape */
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && _panelOpen) closePanel();
    });
  }

  function init() {
    wire();
  }

  /* set bell visibility based on cloud mode */
  function setVisible(visible) {
    var wrap = getEl("notif-wrap");
    var mobileBtn = getEl("btn-notif-mobile");
    if (wrap) wrap.hidden = !visible;
    if (mobileBtn) mobileBtn.hidden = !visible;
    if (!visible) closePanel();
  }

  /* ----------------------------- public API ----------------------------- */

  ET.notifications = {
    load: load,
    refresh: refresh,
    renderBadge: renderBadge,
    renderPanel: renderPanel,
    fetchNotifications: fetchNotifications,
    createNotification: createNotification,
    markAsRead: markAsRead,
    markAllAsRead: markAllAsRead,
    deleteNotification: deleteNotification,
    clearReadNotifications: clearReadNotifications,
    checkFinancialAlerts: checkFinancialAlerts,
    togglePanel: togglePanel,
    closePanel: closePanel,
    setVisible: setVisible,
    init: init
  };
})(window);