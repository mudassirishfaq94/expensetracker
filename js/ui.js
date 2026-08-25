/* =========================================================================
   ui.js — all DOM rendering & presentation
   Pure "given data, paint the screen" helpers plus small UI controllers
   (drawer, modal, toasts). No business logic and no localStorage here.

   Attaches to: window.ET.ui
   ========================================================================= */
(function (global, document) {
  "use strict";

  var ET = (global.ET = global.ET || {});
  var expenses = ET.expenses;
  var storage = ET.storage;
  var sheets = ET.sheets;
  var reports = ET.reports;
  var budgets = ET.budgets;
  var recurring = ET.recurring;
  var data = ET.data;

  function $(sel, root) { return (root || document).querySelector(sel); }
  function el(id) { return document.getElementById(id); }

  function esc(str) {
    if (str == null) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatCurrency(amount) {
    var n = Number(amount) || 0;
    var s = n.toLocaleString("en-AE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return storage.DEFAULT_CURRENCY + " " + s;
  }

  function signedCurrency(amount, type) {
    var abs = Math.abs(Number(amount) || 0);
    if (type === "income") return "+ " + formatCurrency(abs);
    return "− " + formatCurrency(abs);
  }

  function formatDate(dateStr) {
    if (!dateStr) return "";
    var parts = dateStr.split("-");
    if (parts.length !== 3) return dateStr;
    var d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    var months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    return d.getDate() + " " + months[d.getMonth()] + " " + d.getFullYear();
  }

  function formatRelativeTime(ts) {
    if (!ts) return "Never";
    var d = new Date(ts);
    var now = new Date();
    var sameDay = d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
    var hrs = d.getHours();
    var mins = String(d.getMinutes()).padStart(2, "0");
    var ampm = hrs >= 12 ? "PM" : "AM";
    var h12 = ((hrs + 11) % 12) + 1;
    var time = h12 + ":" + mins + " " + ampm;
    if (sameDay) return "Today at " + time;
    var y = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    if (d.getFullYear() === y.getFullYear() && d.getMonth() === y.getMonth() && d.getDate() === y.getDate()) {
      return "Yesterday at " + time;
    }
    var months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    return d.getDate() + " " + months[d.getMonth()] + (d.getFullYear() !== now.getFullYear() ? " " + d.getFullYear() : "") + ", " + time;
  }

  function relativeDay(dateStr) {
    var today = expenses._util.todayKey();
    if (dateStr === today) return "Today";
    var a = new Date(dateStr + "T00:00:00");
    var b = new Date(today + "T00:00:00");
    var diff = Math.round((b - a) / 86400000);
    if (diff === 1) return "Yesterday";
    if (diff > 1 && diff < 7) return diff + " days ago";
    if (diff < 0) return "Upcoming";
    return "";
  }

  function initials(text) {
    var t = (text || "?").trim();
    return t ? t.charAt(0).toUpperCase() : "?";
  }

  var PALETTE = [
    "#1E7A52", "#B4402E", "#C9A227", "#3A5573", "#6C3F73",
    "#C08A2E", "#3E9366", "#C86A57", "#5878A0", "#9B5BA5",
    "#2E9A68", "#B06A3C", "#3E8AAB", "#8A8474", "#6466C4",
    "#3D9A6E", "#5A9A4A", "#6A9A38", "#3E9A88", "#9A7A38"
  ];
  function paletteColor(index) {
    return PALETTE[index % PALETTE.length];
  }

  function formatPct(p) {
    if (p == null || isNaN(Number(p))) return "0%";
    return (Math.round(Number(p) * 100) / 100) + "%";
  }

  function daysUntil(dateStr) {
    if (!dateStr) return 0;
    var parts = dateStr.split("-");
    if (parts.length !== 3) return 0;
    var d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    var now = new Date();
    now.setHours(0, 0, 0, 0);
    return Math.round((d - now) / 86400000);
  }

  function storageInfoRow(label, value) {
    return '<div class="storage-row"><span class="storage-label">' + esc(label) + '</span><span class="storage-value">' + esc(value) + "</span></div>";
  }

  function badge(category) {
    var slug = storage.categorySlug(category);
    return '<span class="badge ' + slug + '"><span class="dot"></span>' + esc(category) + "</span>";
  }

  function typeBadge(type) {
    if (type === "income") {
      return '<span class="type-badge income"><span class="type-sign income" aria-hidden="true">+</span> Income</span>';
    }
    return '<span class="type-badge expense"><span class="type-sign expense" aria-hidden="true">−</span> Expense</span>';
  }

  function syncBadge(record) {
    var st = record.syncStatus === "synced" ? "synced"
      : record.syncStatus === "failed" ? "failed"
      : "pending";
    if (st === "synced") {
      return (
        '<span class="sync-badge is-synced" title="Synced to Google Sheets">' +
          '<svg viewBox="0 0 24 24" width="11" height="11" aria-hidden="true"><path d="M5 12l5 5 9-10" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
          "Synced</span>"
      );
    }
    if (st === "failed") {
      return (
        '<button type="button" class="sync-badge is-failed" data-retry-sync="' + esc(record.id) + '" title="Failed to sync. Click to retry.">' +
          '<svg viewBox="0 0 24 24" width="11" height="11" aria-hidden="true"><path d="M12 7v5M12 16.5v.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/></svg>' +
          "Failed</button>"
      );
    }
    return (
      '<span class="sync-badge is-pending" title="Not synced to Google Sheets yet">' +
        '<svg viewBox="0 0 24 24" width="11" height="11" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 7v5l3 2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>' +
        "Pending</span>"
    );
  }

  function recordType(record) {
    return expenses._util.recordType(record);
  }

  var _heroRAF = null;
  function animateHero(node, to) {
    if (!node) return;
    var reduce = global.matchMedia && global.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var from = Number(node.getAttribute("data-amount")) || 0;
    node.setAttribute("data-amount", String(to));

    if (reduce || from === to) {
      node.textContent = formatCurrency(to);
      return;
    }
    if (_heroRAF) cancelAnimationFrame(_heroRAF);
    var start = null;
    var dur = 650;
    function step(t) {
      if (start === null) start = t;
      var p = Math.min((t - start) / dur, 1);
      var eased = 1 - Math.pow(1 - p, 3);
      node.textContent = formatCurrency(from + (to - from) * eased);
      if (p < 1) _heroRAF = requestAnimationFrame(step);
    }
    _heroRAF = requestAnimationFrame(step);
  }

  function fillSelectOptions(select, categories, keepValue) {
    var current = keepValue != null ? keepValue : select.value;
    var first = select.querySelector('option[value=""]');
    var placeholder = first ? first.outerHTML : '<option value="">Select a category</option>';
    select.innerHTML = placeholder;
    categories.forEach(function (cat) {
      var o = document.createElement("option");
      o.value = cat;
      o.textContent = cat;
      select.appendChild(o);
    });
    var stillValid = current === "" || categories.indexOf(current) !== -1;
    select.value = stillValid ? current : "";
    return select.value;
  }

  var ui = {
    esc: esc,
    formatCurrency: formatCurrency,
    formatDate: formatDate,
    formatRelativeTime: formatRelativeTime,

    populateFormCategories: function (type, keepValue) {
      var formSel = el("field-category");
      var cats = storage.categoriesFor(type);
      return fillSelectOptions(formSel, cats, keepValue);
    },

    populateFilterCategories: function (type, keepValue) {
      var filterSel = el("filter-category");
      var cats = !type || type === "all"
        ? storage.allCategories()
        : storage.categoriesFor(type);
      var current = keepValue != null ? keepValue : filterSel.value;
      filterSel.innerHTML = '<option value="">All categories</option>';
      if (!type || type === "all") {
        var expGroup = document.createElement("optgroup");
        expGroup.label = "Expenses";
        storage.EXPENSE_CATEGORIES.forEach(function (cat) {
          var o = document.createElement("option");
          o.value = cat; o.textContent = cat;
          expGroup.appendChild(o);
        });
        var incGroup = document.createElement("optgroup");
        incGroup.label = "Income";
        storage.INCOME_CATEGORIES.forEach(function (cat) {
          var o = document.createElement("option");
          o.value = cat; o.textContent = cat;
          incGroup.appendChild(o);
        });
        filterSel.appendChild(expGroup);
        filterSel.appendChild(incGroup);
      } else {
        cats.forEach(function (cat) {
          var o = document.createElement("option");
          o.value = cat; o.textContent = cat;
          filterSel.appendChild(o);
        });
      }
      var allowed = !type || type === "all" ? storage.allCategories() : cats;
      var stillValid = current === "" || allowed.indexOf(current) !== -1;
      filterSel.value = stillValid ? current : "";
      return filterSel.value;
    },

    populateCategorySelects: function () {
      this.populateFormCategories("expense");
      this.populateFilterCategories("all");
    },

    populateMonthFilter: function (list, keepValue) {
      var sel = el("filter-month");
      var months = expenses.availableMonths(list);
      var current = keepValue != null ? keepValue : sel.value;
      sel.innerHTML = '<option value="">All months</option>';
      months.forEach(function (m) {
        var o = document.createElement("option");
        o.value = m.key; o.textContent = m.label;
        sel.appendChild(o);
      });
      var stillValid = current === "" || months.some(function (m) { return m.key === current; });
      sel.value = stillValid ? current : "";
      return sel.value;
    },

    setTypeFilterChips: function (type) {
      var value = type || "all";
      document.querySelectorAll("[data-type-filter]").forEach(function (btn) {
        btn.classList.toggle("is-active", btn.getAttribute("data-type-filter") === value);
      });
    },

    setFormType: function (type, keepCategory) {
      type = storage.normalizeType(type);
      el("field-type").value = type;
      document.querySelectorAll("[data-form-type]").forEach(function (btn) {
        var on = btn.getAttribute("data-form-type") === type;
        btn.classList.toggle("is-active", on);
        btn.setAttribute("aria-pressed", on ? "true" : "false");
      });
      var kept = this.populateFormCategories(type, keepCategory);
      var vendorLabel = el("label-vendor");
      var vendorInput = el("field-vendor");
      var titleInput = el("field-title");
      if (type === "income") {
        vendorLabel.textContent = "Source";
        vendorInput.placeholder = "e.g. Company Name";
        titleInput.placeholder = "e.g. Monthly Salary";
      } else {
        vendorLabel.textContent = "Store / vendor";
        vendorInput.placeholder = "e.g. Carrefour";
        titleInput.placeholder = "e.g. Sugar";
      }
      return kept;
    },

    /* -------------------- DASHBOARD -------------------- */
    renderDashboard: function (list) {
      var hasData = list.length > 0;
      el("dashboard-empty").hidden = hasData;
      el("dashboard-content").hidden = !hasData;
      if (!hasData) return;

      var s = expenses.stats(list);

      el("hero-count-chip").textContent =
        s.totalCount + (s.totalCount === 1 ? " transaction" : " transactions");
      animateHero(el("stat-balance"), s.totalBalance);

      el("stat-income").textContent = signedCurrency(s.totalIncome, "income");
      el("stat-income-foot").textContent =
        s.incomeCount + (s.incomeCount === 1 ? " income entry" : " income entries");

      el("stat-expenses").textContent = signedCurrency(s.totalExpenses, "expense");
      el("stat-expenses-foot").textContent =
        s.expenseCount + (s.expenseCount === 1 ? " expense" : " expenses");

      var monthBalanceNode = el("stat-month-balance");
      monthBalanceNode.textContent = formatCurrency(s.monthBalance);
      monthBalanceNode.classList.toggle("is-income", s.monthBalance > 0);
      monthBalanceNode.classList.toggle("is-expense", s.monthBalance < 0);
      el("stat-month-foot").textContent = s.monthLabel;

      el("stat-today").textContent = formatCurrency(s.todaySpending);
      el("stat-today-foot").textContent = s.todayCount === 0
        ? "No expenses today"
        : s.todayCount + (s.todayCount === 1 ? " expense today" : " expenses today");

      el("stat-count").textContent = String(s.totalCount);
      el("stat-count-foot").textContent =
        s.incomeCount + " income · " + s.expenseCount + " expenses";

      el("summary-month-note").textContent = s.monthLabel;
      el("sum-income").textContent = formatCurrency(s.totalIncome);
      el("sum-expenses").textContent = formatCurrency(s.totalExpenses);
      el("sum-balance").textContent = formatCurrency(s.totalBalance);
      el("sum-balance").classList.toggle("is-income", s.totalBalance > 0);
      el("sum-balance").classList.toggle("is-expense", s.totalBalance < 0);
      el("sum-month-income").textContent = formatCurrency(s.monthIncome);
      el("sum-month-expenses").textContent = formatCurrency(s.monthExpenses);
      el("sum-month-balance").textContent = formatCurrency(s.monthBalance);
      el("sum-month-balance").classList.toggle("is-income", s.monthBalance > 0);
      el("sum-month-balance").classList.toggle("is-expense", s.monthBalance < 0);

      this.renderHeroBreakdown(list);
      this.renderCategoryBreakdown(list, s);
      this.renderRecent(list);
    },

    renderHeroBreakdown: function (list) {
      var bar = el("hero-breakdown");
      if (!bar) return;
      var s = expenses.stats(list);
      var income = s.totalIncome;
      var expensesAmt = s.totalExpenses;
      var total = income + expensesAmt;
      if (total <= 0) {
        bar.style.display = "none";
        bar.innerHTML = "";
        return;
      }
      bar.style.display = "flex";
      var incomePct = Math.max(2, (income / total) * 100);
      var expensePct = Math.max(2, (expensesAmt / total) * 100);
      bar.innerHTML =
        '<span class="seg seg-income" style="width:' + incomePct + '%" title="Income"></span>' +
        '<span class="seg seg-expense" style="width:' + expensePct + '%" title="Expenses"></span>';
    },

    renderCategoryBreakdown: function (list, s) {
      var container = el("category-breakdown");
      var rows = expenses.spendingByCategory(list);
      el("cat-note").textContent = s.monthLabel;

      if (rows.length === 0) {
        container.innerHTML =
          '<p class="stat-foot" style="padding:6px 2px">No expenses recorded this month yet.</p>';
        return;
      }
      var max = rows[0].amount || 1;
      var html = rows.map(function (r) {
        var slug = storage.categorySlug(r.category);
        var width = Math.max(4, (r.amount / max) * 100);
        return (
          '<div class="cat-row">' +
            '<span class="cat-name"><span class="cat-dot ' + slug + '" style="background:var(--c)"></span>' + esc(r.category) + "</span>" +
            '<span class="cat-amt">' + formatCurrency(r.amount) + "</span>" +
            '<span class="cat-track"><span class="cat-fill ' + slug + '" style="width:' + width + '%;background:var(--c)"></span></span>' +
          "</div>"
        );
      }).join("");
      container.innerHTML = html;
    },

    renderRecent: function (list) {
      var container = el("recent-activity");
      var recent = expenses.sortNewestFirst(list).slice(0, 6);
      container.innerHTML = recent.map(function (e) {
        var type = recordType(e);
        var slug = storage.categorySlug(e.category);
        var meta = [type === "income" ? "Income" : "Expense", e.category, e.vendor].filter(Boolean).join(" · ");
        return (
          '<li class="recent-item">' +
            '<span class="recent-avatar ' + slug + '" style="background:var(--bg);color:var(--fg)">' + esc(initials(e.title)) + "</span>" +
            '<span class="recent-main">' +
              '<span class="recent-title">' + esc(e.title) + "</span>" +
              '<span class="recent-meta">' + esc(meta) + "</span>" +
            "</span>" +
            '<span class="recent-amt ' + (type === "income" ? "is-income" : "is-expense") + '">' +
              signedCurrency(e.amount, type) +
            "</span>" +
          "</li>"
        );
      }).join("");
    },

    /* -------------------- TRANSACTION LIST -------------------- */
    renderList: function (filtered, allCount) {
      var container = el("expense-list-container");
      var emptyAll = el("expenses-empty");
      var emptyNoResults = el("expenses-no-results");

      if (allCount === 0) {
        container.innerHTML = "";
        emptyAll.hidden = false;
        emptyNoResults.hidden = true;
        el("result-count").textContent = "0 transactions";
        el("result-total").textContent = "";
        return;
      }
      emptyAll.hidden = true;

      if (filtered.length === 0) {
        container.innerHTML = "";
        emptyNoResults.hidden = false;
        el("result-count").textContent = "No matches";
        el("result-total").textContent = "";
        return;
      }
      emptyNoResults.hidden = true;

      var sorted = expenses.sortNewestFirst(filtered);
      var totals = expenses.filteredTotals(sorted);

      el("result-count").textContent =
        sorted.length + (sorted.length === 1 ? " transaction" : " transactions");
      el("result-total").textContent =
        "+ " + formatCurrency(totals.income) + " income  ·  − " + formatCurrency(totals.expenses) + " expenses";

      container.innerHTML = buildTable(sorted) + buildCards(sorted);
    },

    /* -------------------- DRAWER (add / edit / review) -------------------- */
    openDrawer: function (mode, record, defaultType, confidence) {
      var drawer = el("drawer");
      var overlay = el("drawer-overlay");
      var form = el("expense-form");

      form.reset();
      ui.clearFieldErrors();

      if (mode === "review" && record) {
        var reviewType = storage.normalizeType(record.type);
        el("drawer-eyebrow").textContent = "Smart entry";
        el("drawer-title").textContent = "Review transaction";
        el("btn-save").textContent = "Save transaction";
        el("field-id").value = "";
        ui.setFormType(reviewType, record.category);
        el("field-title").value = record.title || "";
        el("field-amount").value = record.amount != null ? record.amount : "";
        el("field-category").value = record.category || "";
        el("field-vendor").value = record.vendor || "";
        el("field-date").value = record.date || expenses._util.todayKey();
        el("field-notes").value = record.notes || "";
        ui.showReviewBanner(confidence);
      } else if (mode === "edit" && record) {
        var type = recordType(record);
        el("drawer-eyebrow").textContent = "Editing";
        el("drawer-title").textContent = "Edit transaction";
        el("btn-save").textContent = "Save changes";
        el("field-id").value = record.id;
        ui.setFormType(type, record.category);
        el("field-title").value = record.title || "";
        el("field-amount").value = record.amount != null ? record.amount : "";
        el("field-category").value = record.category || "";
        el("field-vendor").value = record.vendor || "";
        el("field-date").value = record.date || "";
        el("field-notes").value = record.notes || "";
        ui.hideReviewBanner();
      } else {
        var addType = storage.normalizeType(defaultType || "expense");
        el("drawer-eyebrow").textContent = "New entry";
        el("drawer-title").textContent = "Add transaction";
        el("btn-save").textContent = "Save transaction";
        el("field-id").value = "";
        ui.setFormType(addType);
        el("field-date").value = expenses._util.todayKey();
        ui.hideReviewBanner();
      }

      overlay.hidden = false;
      drawer.setAttribute("aria-hidden", "false");
      void drawer.offsetWidth;
      overlay.classList.add("is-shown");
      drawer.classList.add("is-open");
      setTimeout(function () { el("field-title").focus(); }, 120);
    },

    showReviewBanner: function (confidence) {
      var banner = el("review-banner");
      if (!banner) return;
      banner.hidden = false;
      banner.classList.remove("is-warning", "is-high");
      var title = el("review-banner-title");
      var text = el("review-banner-text");
      if (confidence === "high") {
        banner.classList.add("is-high");
        title.textContent = "Transaction detected";
        text.textContent = "This looks right — review the details and save.";
      } else {
        banner.classList.add("is-warning");
        title.textContent = "Please review";
        text.textContent = "Please review the detected information before saving.";
      }
    },

    hideReviewBanner: function () {
      var banner = el("review-banner");
      if (!banner) return;
      banner.hidden = true;
      banner.classList.remove("is-warning", "is-high");
    },

    closeDrawer: function () {
      var drawer = el("drawer");
      var overlay = el("drawer-overlay");
      drawer.classList.remove("is-open");
      overlay.classList.remove("is-shown");
      drawer.setAttribute("aria-hidden", "true");
      setTimeout(function () { overlay.hidden = true; }, 300);
    },

    isDrawerOpen: function () {
      return el("drawer").classList.contains("is-open");
    },

    showFieldErrors: function (errors) {
      ui.clearFieldErrors();
      var map = { title: "err-title", amount: "err-amount", category: "err-category", date: "err-date" };
      var first = null;
      Object.keys(map).forEach(function (key) {
        var msgNode = el(map[key]);
        var input = el("field-" + key);
        if (errors[key]) {
          msgNode.textContent = errors[key];
          msgNode.hidden = false;
          if (input) {
            input.closest(".field").classList.add("has-error");
            input.setAttribute("aria-invalid", "true");
          }
          if (!first) first = input;
        }
      });
      if (first) first.focus();
    },

    clearFieldErrors: function () {
      ["title", "amount", "category", "date"].forEach(function (key) {
        var msgNode = el("err-" + key);
        var input = el("field-" + key);
        if (msgNode) { msgNode.hidden = true; msgNode.textContent = ""; }
        if (input) {
          input.setAttribute("aria-invalid", "false");
          var f = input.closest(".field");
          if (f) f.classList.remove("has-error");
        }
      });
    },

openConfirm: function (message, title, confirmLabel) {
    var overlay = el("confirm-overlay");
    if (message) el("confirm-text").textContent = message;
    if (title) el("confirm-title").textContent = title;
    if (confirmLabel) el("btn-confirm-delete").textContent = confirmLabel;
    overlay.hidden = false;
    void overlay.offsetWidth;
    overlay.classList.add("is-shown");
    setTimeout(function () { el("btn-confirm-delete").focus(); }, 60);
  },
  closeConfirm: function () {
    var overlay = el("confirm-overlay");
    overlay.classList.remove("is-shown");
    setTimeout(function () {
      overlay.hidden = true;
      el("confirm-title").textContent = "Delete this transaction?";
      el("btn-confirm-delete").textContent = "Delete";
    }, 200);
  },
    isConfirmOpen: function () {
      return !el("confirm-overlay").hidden;
    },

    toast: function (message, type) {
      type = type || "success";
      var container = el("toast-container");
      var node = document.createElement("div");
      node.className = "toast " + type;

      var icon = type === "error"
        ? '<path d="M12 8v5M12 16.5v.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/>'
        : type === "info"
        ? '<path d="M12 11v5M12 8v.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/>'
        : '<path d="M5 12l5 5 9-10" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>';

      node.innerHTML =
        '<span class="toast-ico"><svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">' + icon + "</svg></span>" +
        "<span>" + esc(message) + "</span>";
      container.appendChild(node);
      void node.offsetWidth;
      node.classList.add("is-shown");

      setTimeout(function () {
        node.classList.remove("is-shown");
        setTimeout(function () {
          if (node.parentNode) node.parentNode.removeChild(node);
        }, 320);
      }, 2600);
    },

    /* -------------------- view switching -------------------- */
    setView: function (view, navKey) {
      el("view-dashboard").hidden = view !== "dashboard";
      el("view-expenses").hidden = view !== "transactions";
      el("view-sheets").hidden = view !== "sheets";
      el("view-reports").hidden = view !== "reports";
      el("view-budgets").hidden = view !== "budgets";
      el("view-recurring").hidden = view !== "recurring";
      el("view-data").hidden = view !== "data";

      var titles = {
        dashboard: { title: "Dashboard", eyebrow: "Overview" },
        transactions: { title: "Transactions", eyebrow: "All activity" },
        income: { title: "Income", eyebrow: "Incoming money" },
        expenses: { title: "Expenses", eyebrow: "Outgoing money" },
        sheets: { title: "Google Sheets", eyebrow: "Cloud backup & sync" },
        reports: { title: "Reports", eyebrow: "Analytics & insights" },
        budgets: { title: "Budgets & Goals", eyebrow: "Limits & savings targets" },
        recurring: { title: "Recurring", eyebrow: "Scheduled income & expenses" },
        data: { title: "Data & Backup", eyebrow: "Export, import & manage" }
      };
      var key = navKey || view;
      var meta = titles[key] || titles.transactions;
      el("view-title").textContent = meta.title;
      el("view-eyebrow").textContent = meta.eyebrow;

      var items = document.querySelectorAll(".nav-item[data-view]");
      items.forEach(function (btn) {
        btn.classList.toggle("is-active", btn.getAttribute("data-view") === key);
      });
    },

    /* -------------------- Google Sheets page -------------------- */
    renderSheetsPage: function () {
      var cfg = sheets.getConfig();
      var urlOk = sheets.hasValidUrl();
      var connected = sheets.isConnected();

      var urlInput = el("sheets-url");
      if (urlInput && urlInput.value === "" && cfg.webAppUrl) {
        urlInput.value = cfg.webAppUrl || "";
        el("sheets-spreadsheet").value = cfg.spreadsheetName || "";
        el("sheets-sheet").value = cfg.sheetName || "Transactions";
      }
      var codePre = el("apps-script-code");
      if (codePre && !codePre.textContent) codePre.textContent = sheets.APP_SCRIPT_CODE;

      var dot = el("sheets-status-dot");
      var title = el("sheets-status-title");
      var sub = el("sheets-status-sub");
      var disconnectBtn = el("btn-disconnect");

      if (connected) {
        dot.className = "status-dot is-ok";
        title.textContent = "Connected";
        sub.textContent = "Transactions sync automatically to your spreadsheet.";
        if (disconnectBtn) disconnectBtn.hidden = false;
      } else if (urlOk && cfg.lastError) {
        dot.className = "status-dot is-fail";
        title.textContent = "Sync Failed";
        sub.textContent = cfg.lastError || "Last attempt to reach Google Sheets failed.";
        if (disconnectBtn) disconnectBtn.hidden = false;
      } else {
        dot.className = "status-dot";
        title.textContent = "Not Connected";
        sub.textContent = urlOk
          ? "Press \u201CTest Connection\u201D to verify the Web App URL."
          : "Connect a Google Spreadsheet to back up your transactions.";
        if (disconnectBtn) disconnectBtn.hidden = true;
      }

      var lastSync = el("sheets-last-sync");
      if (lastSync) lastSync.textContent = formatRelativeTime(cfg.lastSyncedAt);
      var ssName = el("sheets-spreadsheet-name");
      if (ssName) ssName.textContent = urlOk && cfg.spreadsheetName ? cfg.spreadsheetName : "\u2014";

      var syncBtns = [el("btn-sync-all"), el("btn-sync-existing")];
      syncBtns.forEach(function (b) {
        if (b) b.disabled = !urlOk;
      });
    },

    setSheetsStatus: function (mode) {
      var dot = el("sheets-status-dot");
      var title = el("sheets-status-title");
      var sub = el("sheets-status-sub");
      if (!dot) return;
      if (mode === "syncing") {
        dot.className = "status-dot is-busy";
        title.textContent = "Syncing";
        sub.textContent = "Sending transactions to Google Sheets\u2026";
      } else if (mode === "testing") {
        dot.className = "status-dot is-busy";
        title.textContent = "Testing Connection";
        sub.textContent = "Contacting the Google Apps Script Web App\u2026";
      }
    },

    showSheetsError: function (message) {
      var errBox = el("sheets-error");
      if (!errBox) return;
      errBox.textContent = message;
      errBox.hidden = false;
    },

    hideSheetsError: function () {
      var errBox = el("sheets-error");
      if (errBox) {
        errBox.hidden = true;
        errBox.textContent = "";
      }
    },

    showSheetsResult: function (message, isError) {
      var box = el("sheets-result");
      if (!box) return;
      box.textContent = message;
      box.classList.toggle("is-error", !!isError);
      box.hidden = false;
    },

    /* -------------------- REPORTS -------------------- */

    setReportRangeChips: function (range) {
      document.querySelectorAll("[data-range]").forEach(function (btn) {
        btn.classList.toggle("is-active", btn.getAttribute("data-range") === range);
      });
      var custom = el("custom-range");
      if (custom) custom.hidden = range !== "custom";
    },

    setReportTypeChips: function (type) {
      document.querySelectorAll("[data-rtype]").forEach(function (btn) {
        btn.classList.toggle("is-active", btn.getAttribute("data-rtype") === type);
      });
    },

    populateReportCategories: function (list, keepValue) {
      var sel = el("report-category");
      var cats = reports.availableCategories(list, "all");
      var current = keepValue != null ? keepValue : sel.value;
      sel.innerHTML = '<option value="">All Categories</option>';
      cats.forEach(function (cat) {
        var o = document.createElement("option");
        o.value = cat;
        o.textContent = cat;
        sel.appendChild(o);
      });
      var stillValid = current === "" || cats.indexOf(current) !== -1;
      sel.value = stillValid ? current : "";
      return sel.value;
    },

    renderReportsPage: function (all, filters) {
      /* Always start from scratch: reset every state so a previous empty
         result can never keep the page stuck. */
      var filteredEmpty = el("reports-filtered-empty");
      var content = el("reports-content");
      var hasAny = all.length > 0;

      if (filteredEmpty) filteredEmpty.hidden = true;
      el("reports-empty").hidden = hasAny;
      if (content) content.hidden = !hasAny;

      if (!hasAny) {
        this.destroyAllCharts();
        return;
      }

      var rangeDays = reports.detectRangeDays(filters.range, filters.start, filters.end);
      var list = reports.getFilteredReportTransactions(all, filters);

      if (list.length === 0) {
        /* Temporary empty state — the DOM stays intact so a later filter
           change can always restore the full reports. */
        this.destroyAllCharts();
        if (content) content.hidden = true;
        if (filteredEmpty) {
          var type = filters.type === "income" ? "income"
            : filters.type === "expense" ? "expense"
            : null;
          var msg = type === "income"
            ? "No income data available for this period."
            : type === "expense"
            ? "No expense data available for this period."
            : "No transactions found for this period.";
          var feText = el("reports-filtered-empty-text");
          if (feText) feText.textContent = msg + " Try a different date range, type, or category.";
          filteredEmpty.hidden = false;
        }
        return;
      }

      if (content) content.hidden = false;

      var data = reports.allReports(list);

      /* overview cards */
      var o = data.overview;
      el("report-total-income").textContent = "+ " + this.formatCurrency(o.totalIncome);
      el("report-income-foot").textContent = o.incomeCount + (o.incomeCount === 1 ? " entry" : " entries");
      el("report-total-expenses").textContent = "− " + this.formatCurrency(o.totalExpenses);
      el("report-expense-foot").textContent = o.expenseCount + (o.expenseCount === 1 ? " entry" : " entries");
      var balNode = el("report-balance");
      balNode.textContent = this.formatCurrency(o.balance);
      balNode.classList.toggle("is-income", o.balance > 0);
      balNode.classList.toggle("is-expense", o.balance < 0);
      el("report-balance-foot").textContent = o.balance >= 0 ? "Positive balance" : "Negative balance";
      var savNode = el("report-savings");
      savNode.textContent = o.savingsRate == null ? "N/A" : o.savingsRate.toFixed(1) + "%";
      savNode.classList.remove("is-income", "is-expense");
      if (o.savingsRate != null) {
        savNode.classList.toggle("is-income", o.savingsRate >= 0);
        savNode.classList.toggle("is-expense", o.savingsRate < 0);
      }

      /* charts */
      this.renderIncomeExpenseChart(data);
      this.renderExpenseCategoryChart(data);
      this.renderIncomeCategoryChart(data);
      this.renderMonthlyTrendChart(data);
      this.renderSpendingTrendChart(list, rangeDays);

      /* insights */
      this.renderInsights(data.insights);

      /* top lists */
      this.renderTopExpenses(data.topExpenses);
      this.renderTopIncome(data.topIncome);
    },

    renderInsights: function (insights) {
      var box = el("report-insights");
      if (!box) return;
      box.innerHTML = insights.map(function (text) {
        return (
          '<li class="insight-item">' +
            '<span class="insight-ico" aria-hidden="true">' +
              '<svg viewBox="0 0 24 24" width="15" height="15"><path d="M12 3l2.7 5.8 6.3.7-4.7 4.3 1.3 6.2L12 17l-5.6 3 1.3-6.2L3 9.5l6.3-.7z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>' +
            "</span>" +
            "<span>" + esc(text) + "</span>" +
          "</li>"
        );
      }).join("");
    },

    renderTopExpenses: function (rows) {
      var box = el("report-top-expenses");
      if (!box) return;
      el("report-top-exp-note").textContent = rows.length + (rows.length === 1 ? " expense" : " expenses");
      if (!rows.length) {
        box.innerHTML = '<li class="top-item muted">No expense data for this period.</li>';
        return;
      }
      box.innerHTML = rows.map(function (r, i) {
        return (
          '<li class="top-item">' +
            '<span class="top-rank">' + (i + 1) + "</span>" +
            '<span class="top-main">' +
              '<span class="top-title">' + esc(r.title) + "</span>" +
              '<span class="top-meta">' + esc(r.category) + " · " + esc(formatDate(r.date)) + "</span>" +
            "</span>" +
            '<span class="top-amt is-expense">' + formatCurrency(Number(r.amount) || 0) + "</span>" +
          "</li>"
        );
      }).join("");
    },

    renderTopIncome: function (rows) {
      var box = el("report-top-income");
      if (!box) return;
      el("report-top-inc-note").textContent = rows.length + (rows.length === 1 ? " income" : " incomes");
      if (!rows.length) {
        box.innerHTML = '<li class="top-item muted">No income data for this period.</li>';
        return;
      }
      box.innerHTML = rows.map(function (r, i) {
        return (
          '<li class="top-item">' +
            '<span class="top-rank">' + (i + 1) + "</span>" +
            '<span class="top-main">' +
              '<span class="top-title">' + esc(r.title) + "</span>" +
              '<span class="top-meta">' + esc(r.category) + " · " + esc(formatDate(r.date)) + "</span>" +
            "</span>" +
            '<span class="top-amt is-income">' + formatCurrency(Number(r.amount) || 0) + "</span>" +
          "</li>"
        );
      }).join("");
    },

    /* -------------------- CHART MANAGEMENT -------------------- */
    /* Keeps one Chart instance per canvas — old charts are always destroyed
       before re-rendering, so filters never stack or leak charts. */

    renderIncomeExpenseChart: function (data) {
      var canvas = el("report-ivs-chart");
      var wrap = el("report-ivs-wrap");
      var iv = data.incomeVsExpense;
      var labels = ["Income", "Expenses"];
      var values = [iv.income, iv.expenses];
      var colors = ["#1E7A52", "#B4402E"];
      if (values.every(function (v) { return v === 0; })) {
        this.setChartEmpty(wrap, "No income or expense data for this period.");
        return;
      }
      this.setChartEmpty(wrap, null);
      this.renderChart(canvas, {
        type: "bar",
        data: {
          labels: labels,
          datasets: [{
            label: "Amount",
            data: values,
            backgroundColor: colors,
            borderRadius: 8,
            maxBarThickness: 90
          }]
        },
        options: this.chartOptions("AED", true)
      });
    },

    renderExpenseCategoryChart: function (data) {
      var canvas = el("report-exp-cat-chart");
      var wrap = el("report-exp-cat-wrap");
      var bd = data.expenseCategory;
      el("report-exp-cat-note").textContent = this.formatCurrency(bd.total) + " total";
      if (!bd.rows.length) {
        this.setChartEmpty(wrap, "No expense data for this period.");
        return;
      }
      this.setChartEmpty(wrap, null);
      this.renderChart(canvas, {
        type: "doughnut",
        data: {
          labels: bd.rows.map(function (r) { return r.category; }),
          datasets: [{
            data: bd.rows.map(function (r) { return r.amount; }),
            backgroundColor: bd.rows.map(function (_, i) { return paletteColor(i); }),
            borderWidth: 2,
            borderColor: "#FFFFFF"
          }]
        },
        options: this.chartOptions("AED", false, "Category", bd.rows)
      });
    },

    renderIncomeCategoryChart: function (data) {
      var canvas = el("report-inc-cat-chart");
      var wrap = el("report-inc-cat-wrap");
      var bd = data.incomeCategory;
      el("report-inc-cat-note").textContent = this.formatCurrency(bd.total) + " total";
      if (!bd.rows.length) {
        this.setChartEmpty(wrap, "No income data for this period.");
        return;
      }
      this.setChartEmpty(wrap, null);
      this.renderChart(canvas, {
        type: "doughnut",
        data: {
          labels: bd.rows.map(function (r) { return r.category; }),
          datasets: [{
            data: bd.rows.map(function (r) { return r.amount; }),
            backgroundColor: bd.rows.map(function (_, i) { return paletteColor(i); }),
            borderWidth: 2,
            borderColor: "#FFFFFF"
          }]
        },
        options: this.chartOptions("AED", false, "Category", bd.rows)
      });
    },

    renderMonthlyTrendChart: function (data) {
      var canvas = el("report-monthly-chart");
      var wrap = el("report-monthly-wrap");
      var trend = data.monthlyTrend;
      if (!trend.length) {
        this.setChartEmpty(wrap, "No transaction data for this period.");
        return;
      }
      this.setChartEmpty(wrap, null);
      this.renderChart(canvas, {
        type: "line",
        data: {
          labels: trend.map(function (m) { return m.monthLabel; }),
          datasets: [
            { label: "Income", data: trend.map(function (m) { return m.income; }), borderColor: "#1E7A52", backgroundColor: "rgba(30,122,82,0.10)", borderWidth: 2.5, tension: 0.3, fill: true, pointRadius: 3 },
            { label: "Expenses", data: trend.map(function (m) { return m.expenses; }), borderColor: "#B4402E", backgroundColor: "rgba(180,64,46,0.10)", borderWidth: 2.5, tension: 0.3, fill: true, pointRadius: 3 },
            { label: "Net", data: trend.map(function (m) { return m.balance; }), borderColor: "#C9A227", backgroundColor: "transparent", borderWidth: 2, borderDash: [5, 4], tension: 0.3, pointRadius: 3 }
          ]
        },
        options: this.chartOptions("AED", true)
      });
    },

    renderSpendingTrendChart: function (list, rangeDays) {
      var canvas = el("report-spend-chart");
      var wrap = el("report-spend-wrap");
      var trend = reports.spendingTrend(list, rangeDays);
      el("report-spend-note").textContent = trend.type === "daily" ? "Daily spending" : "Monthly spending";
      if (!trend.labels.length) {
        this.setChartEmpty(wrap, "No expense data for this period.");
        return;
      }
      this.setChartEmpty(wrap, null);
      this.renderChart(canvas, {
        type: "line",
        data: {
          labels: trend.labels,
          datasets: [{
            label: "Spending",
            data: trend.values,
            borderColor: "#B4402E",
            backgroundColor: "rgba(180,64,46,0.10)",
            borderWidth: 2.5,
            tension: 0.3,
            fill: true,
            pointRadius: 2
          }]
        },
        options: this.chartOptions("AED", true)
      });
    },

    setChartEmpty: function (wrap, message) {
      if (!wrap) return;
      var existing = wrap.querySelector(".chart-empty");
      var canvas = wrap.querySelector("canvas");
      if (!message) {
        if (existing) existing.remove();
        if (canvas) canvas.style.display = "";
        return;
      }
      if (canvas) canvas.style.display = "none";
      if (existing) {
        existing.textContent = message;
        return;
      }
      var p = document.createElement("p");
      p.className = "chart-empty";
      p.textContent = message;
      wrap.appendChild(p);
    },

    renderChart: function (canvas, config) {
      if (!canvas || typeof Chart === "undefined") return;
      var key = canvas.id;
      if (this._charts && this._charts[key]) {
        try { this._charts[key].destroy(); } catch (e) { /* already destroyed */ }
        delete this._charts[key];
      }
      this._charts = this._charts || {};
      this._charts[key] = new Chart(canvas.getContext("2d"), config);
    },

    destroyAllCharts: function () {
      var charts = this._charts || {};
      Object.keys(charts).forEach(function (key) {
        try { charts[key].destroy(); } catch (e) { /* already destroyed */ }
        delete charts[key];
      });
      this._charts = charts;
    },

    chartOptions: function (currency, gridX, tooltipTitle, breakdown) {
      return {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: function (ctx) {
                var val = Number(ctx.parsed.y != null ? ctx.parsed.y : ctx.parsed);
                var label = currency + " " + val.toLocaleString("en-AE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                if (tooltipTitle && breakdown) {
                  var row = breakdown[ctx.dataIndex];
                  if (row) label += " (" + row.pct + "%)";
                }
                return label;
              }
            }
          }
        },
        scales: {
          x: { display: !!gridX, grid: { display: false }, ticks: { color: "#77857B", maxRotation: 45, autoSkip: true, maxTicksLimit: 10 } },
          y: {
            display: !!gridX,
            beginAtZero: true,
            grid: { color: "#EDE7D9" },
            ticks: {
              color: "#77857B",
              callback: function (value) {
                if (Math.abs(value) >= 1000) return (value / 1000).toFixed(1) + "k";
                return value;
              }
            }
          }
        }
      };
    },

    /* -------------------- BUDGETS & GOALS -------------------- */

    budgetBlockHTML: function (label, row) {
      var pct = Math.min(100, row.pct);
      var levelClass = row.level === "exceeded" ? "is-danger" : row.level === "warning" ? "is-warn" : "is-ok";
      var html = '<div class="budget-block">';
      html += '<div class="budget-block-head"><span class="budget-label">' + esc(label) + '</span><span class="budget-amt">' + formatCurrency(row.budget) + '</span></div>';
      html += '<div class="budget-bar"><span class="budget-bar-fill ' + levelClass + '" style="width:' + pct + '%"></span></div>';
      html += '<div class="budget-block-foot"><span>Spent: ' + formatCurrency(row.spent) + '</span><span>Remaining: ' + formatCurrency(row.remaining) + '</span><span class="budget-pct ' + levelClass + '">' + formatPct(row.pct) + '</span></div>';
      if (row.exceeded) html += '<p class="budget-alert is-danger">Exceeded by ' + formatCurrency(row.exceededBy) + '.</p>';
      else if (row.level === "warning") html += '<p class="budget-alert is-warn">Warning: ' + formatPct(row.pct) + ' of this budget used.</p>';
      html += '</div>';
      return html;
    },

    categoryBudgetRowHTML: function (cat, row) {
      var pct = Math.min(100, row.pct);
      var levelClass = row.level === "exceeded" ? "is-danger" : row.level === "warning" ? "is-warn" : "is-ok";
      var html = '<div class="cat-budget-row"><div class="budget-block">';
      html += '<div class="budget-block-head"><span class="budget-label">' + esc(cat) + '</span><span class="budget-amt">' + formatCurrency(row.budget) + '</span></div>';
      html += '<div class="budget-bar"><span class="budget-bar-fill ' + levelClass + '" style="width:' + pct + '%"></span></div>';
      html += '<div class="budget-block-foot"><span>Spent: ' + formatCurrency(row.spent) + '</span><span>Remaining: ' + formatCurrency(row.remaining) + '</span><span class="budget-pct ' + levelClass + '">' + formatPct(row.pct) + '</span></div>';
      if (row.exceeded) html += '<p class="budget-alert is-danger">Exceeded by ' + formatCurrency(row.exceededBy) + '.</p>';
      else if (row.level === "warning") html += '<p class="budget-alert is-warn">Warning: ' + formatPct(row.pct) + ' of this budget used.</p>';
      html += '<button type="button" class="btn btn-ghost btn-sm" data-remove-cat="' + esc(cat) + '">Remove budget</button>';
      html += '</div></div>';
      return html;
    },

    goalCardHTML: function (goal, prog, compact) {
      var pct = Math.min(100, prog.pct);
      var levelClass = prog.completed ? "is-done" : "is-ok";
      var deadline = goal.deadline ? ' &middot; Deadline ' + formatDate(goal.deadline) : '';
      var html = '<div class="goal-card' + (prog.completed ? ' is-completed' : '') + '">';
      html += '<div class="goal-card-head"><span class="goal-name">' + esc(goal.name) + '</span>' + (prog.completed ? '<span class="goal-done-badge">Completed</span>' : '') + '</div>';
      html += '<div class="goal-progress-row"><span>' + formatCurrency(prog.contributed) + '</span><span>of ' + formatCurrency(prog.target) + '</span><span class="goal-pct">' + formatPct(prog.pct) + '</span></div>';
      html += '<div class="budget-bar"><span class="budget-bar-fill ' + levelClass + '" style="width:' + pct + '%"></span></div>';
      html += '<div class="goal-card-foot"><span>' + formatCurrency(prog.remaining) + ' remaining' + deadline + '</span></div>';
      if (!compact) {
        html += '<div class="goal-contribute"><input type="number" class="goal-contrib-input" data-contrib-amount="' + esc(goal.id) + '" min="0.01" step="0.01" placeholder="Amount (AED)" />';
        html += '<button type="button" class="btn btn-primary btn-sm" data-contribute="' + esc(goal.id) + '">Add</button></div>';
        html += '<button type="button" class="btn btn-ghost btn-sm" data-delete-goal="' + esc(goal.id) + '">Delete goal</button>';
      }
      html += '</div>';
      return html;
    },

    renderDashboardBudget: function (transactions) {
      var panel = el("dashboard-budget");
      var body = el("dash-budget-body");
      if (!panel || !body) return;
      var st = budgets.budgetStatus(transactions);
      var cfg = budgets.getBudgetsConfig();
      if (!st.hasMonthlyBudget && !st.hasCategoryBudgets) {
        panel.style.display = "none";
        return;
      }
      panel.style.display = "";
      var html = "";
      if (st.hasMonthlyBudget) html += this.budgetBlockHTML("Monthly budget", st.monthly);
      var cats = Object.keys(st.categories);
      var shown = cats.slice(0, 3);
      shown.forEach(function (cat) { html += this.budgetBlockHTML(cat + " budget", st.categories[cat]); }, this);
      if (cats.length > 3) html += '<p class="budget-more"><a class="link-btn" data-view-jump="budgets" href="#">View all budgets</a></p>';
      body.innerHTML = html;
    },

    renderDashboardGoals: function () {
      var panel = el("dashboard-goals");
      var body = el("dash-goals-body");
      if (!panel || !body) return;
      var goals = budgets.getGoals();
      if (!goals.length) { panel.style.display = "none"; return; }
      panel.style.display = "";
      body.innerHTML = goals.map(function (g) {
        return this.goalCardHTML(g, budgets.computeGoalProgress(g), true);
      }, this).join("");
    },

    renderBudgetsPage: function (transactions) {
      var st = budgets.budgetStatus(transactions);
      var cfg = budgets.getBudgetsConfig();
      var monthLabel = (expenses._util.monthLabel && expenses._util.monthLabel(st.monthKey)) || st.monthKey;
      el("budget-month-label").textContent = "This month &middot; " + monthLabel;

      var mi = el("budget-monthly-input");
      if (cfg.monthly > 0 && mi.value === "") mi.value = cfg.monthly;

      var statusBox = el("monthly-budget-status");
      statusBox.innerHTML = st.hasMonthlyBudget
        ? this.budgetBlockHTML("Monthly spending", st.monthly)
        : '<p class="budgets-hint">Set a monthly limit to track your spending. Income and goal contributions are never counted.</p>';

      var catList = el("category-budget-list");
      var catKeys = Object.keys(st.categories);
      catList.innerHTML = catKeys.length
        ? catKeys.map(function (cat) { return this.categoryBudgetRowHTML(cat, st.categories[cat]); }, this).join("")
        : '<p class="budgets-hint">No category budgets yet. Add one below.</p>';

      this.populateBudgetCategorySelect();

      var goals = budgets.getGoals();
      var goalsBox = el("goals-list");
      goalsBox.innerHTML = goals.length
        ? goals.map(function (g) { return this.goalCardHTML(g, budgets.computeGoalProgress(g), false); }, this).join("")
        : '<p class="budgets-hint">Create your first savings goal to start tracking progress.</p>';
    },

    populateBudgetCategorySelect: function (keepValue) {
      var sel = el("budget-cat-select");
      if (!sel) return;
      var current = keepValue != null ? keepValue : sel.value;
      var used = budgets.getBudgetsConfig().categories;
      var options = (storage.EXPENSE_CATEGORIES || []).filter(function (cat) {
        return !Object.prototype.hasOwnProperty.call(used, cat);
      });
      sel.innerHTML = '<option value="">Choose a category</option>';
      options.forEach(function (cat) {
        var o = document.createElement("option");
        o.value = cat; o.textContent = cat; sel.appendChild(o);
      });
      sel.value = options.indexOf(current) !== -1 ? current : "";
    },

    /* -------------------- RECURRING & SUBSCRIPTIONS -------------------- */

    frequencyLabel: function (freq) {
      var map = { daily: "Daily", weekly: "Weekly", monthly: "Monthly", yearly: "Yearly" };
      return map[freq] || "Monthly";
    },

    dueRelativeLabel: function (daysToDue) {
      if (daysToDue < 0) return "Overdue";
      if (daysToDue === 0) return "Due today";
      if (daysToDue === 1) return "Tomorrow";
      return "In " + daysToDue + " days";
    },

    recurringCardHTML: function (def) {
      var typeClass = def.type === "income" ? "income" : "expense";
      var statusBadge = def.status === "paused"
        ? '<span class="status-badge is-paused">Paused</span>'
        : '<span class="status-badge is-active">Active</span>';
      var subBadge = def.isSubscription ? '<span class="status-badge is-sub">Subscription</span>' : "";
      var review = def.needsReview
        ? '<p class="budget-alert is-warn">Some older periods were skipped (catch-up limit). Review your history.</p>'
        : "";
      var dueDate = def.nextDueDate ? formatDate(def.nextDueDate) : "—";
      var html = '<div class="recurring-card">';
      html += '<div class="recurring-card-head">' +
        '<span class="type-badge ' + typeClass + '"><span class="type-sign ' + typeClass + '" aria-hidden="true">' + (def.type === "income" ? "+" : "−") + '</span> ' + (def.type === "income" ? "Income" : "Expense") + "</span>" +
        '<span class="status-badge is-freq">' + this.frequencyLabel(def.frequency) + "</span>" +
        statusBadge + subBadge +
        "</div>";
      html += '<div class="recurring-card-title">' + esc(def.title) + "</div>";
      html += '<div class="recurring-card-meta">' +
        [def.category, def.vendor, def.isSubscription ? "" : null].filter(Boolean).join(" &middot; ") +
        "</div>";
      html += '<div class="recurring-card-amount ' + (def.type === "income" ? "is-income" : "is-expense") + '">' +
        (def.type === "income" ? "+ " : "− ") + formatCurrency(def.amount) + "</div>";
      html += '<div class="recurring-card-due">Next due: ' + dueDate +
        (def.nextDueDate ? ' <span class="due-rel">' + this.dueRelativeLabel(daysUntil(def.nextDueDate)) + "</span>" : "") +
        "</div>";
      html += review;
      html += '<div class="recurring-card-actions">' +
        '<button type="button" class="btn btn-ghost btn-sm" data-edit-recurring="' + esc(def.id) + '">Edit</button>' +
        (def.status === "paused"
          ? '<button type="button" class="btn btn-primary btn-sm" data-toggle-recurring="' + esc(def.id) + '">Resume</button>'
          : '<button type="button" class="btn btn-ghost btn-sm" data-toggle-recurring="' + esc(def.id) + '">Pause</button>') +
        '<button type="button" class="btn btn-ghost btn-sm" data-delete-recurring="' + esc(def.id) + '">Delete</button>' +
        "</div>";
      html += "</div>";
      return html;
    },

    renderRecurringPage: function () {
      var defs = recurring.getRecurring();
      var activeCount = defs.filter(function (d) { return d.status === "active"; }).length;
      el("recurring-count").textContent = defs.length + (defs.length === 1 ? " definition" : " definitions") + " · " + activeCount + " active";

      this.renderUpcomingPayments();

      var list = el("recurring-list");
      list.innerHTML = defs.length
        ? defs.map(this.recurringCardHTML, this).join("")
        : '<div class="recurring-empty"><p class="budgets-hint">No recurring transactions yet.</p>' +
          '<button class="btn btn-primary" data-action="open-recurring-add" type="button">Add Your First Recurring Transaction</button></div>';

      this.renderSubscriptionsPage();
    },

    renderUpcomingPayments: function () {
      var rows = recurring.upcomingPayments();
      var box = el("upcoming-payments");
      if (!rows.length) {
        box.innerHTML = '<p class="budgets-hint">No upcoming recurring payments.</p>';
        return;
      }
      var groups = [];
      var overdue = rows.filter(function (r) { return r.daysToDue < 0; });
      var today = rows.filter(function (r) { return r.daysToDue === 0; });
      var week = rows.filter(function (r) { return r.daysToDue >= 1 && r.daysToDue <= 7; });
      var month = rows.filter(function (r) { return r.daysToDue > 7; });
      if (overdue.length) groups.push({ label: "Overdue", rows: overdue });
      if (today.length) groups.push({ label: "Today", rows: today });
      if (week.length) groups.push({ label: "Next 7 days", rows: week });
      if (month.length) groups.push({ label: "Next 30 days", rows: month });
      box.innerHTML = groups.map(function (g) {
        var head = '<div class="upcoming-group-head">' + esc(g.label) + "</div>";
        var items = g.rows.map(function (r) {
          return (
            '<div class="upcoming-row">' +
              '<div class="upcoming-main"><span class="upcoming-title">' + esc(r.title) + "</span>" +
              '<span class="upcoming-date">' + formatDate(r.dueDate) + " · " + this.dueRelativeLabel(r.daysToDue) + "</span></div>" +
              '<span class="upcoming-amt ' + (r.type === "income" ? "is-income" : "is-expense") + '">' +
                (r.type === "income" ? "+ " : "− ") + formatCurrency(r.amount) + "</span>" +
            "</div>"
          );
        }, this).join("");
        return head + items;
      }, this).join("");
    },

    renderSubscriptionsPage: function () {
      var defs = recurring.getRecurring().filter(function (d) { return d.isSubscription && d.type === "expense"; });
      var summary = recurring.subscriptionSummary();
      var sumBox = el("subs-summary");
      sumBox.innerHTML =
        '<div class="subs-stat"><span class="subs-stat-value">' + summary.activeCount + "</span><span class=\"subs-stat-label\">Active subscriptions</span></div>" +
        '<div class="subs-stat"><span class="subs-stat-value">' + formatCurrency(summary.monthlyCost) + "</span><span class=\"subs-stat-label\">Monthly cost" + (summary.hasEstimatedMonthly ? " (est.)" : "") + "</span></div>" +
        '<div class="subs-stat"><span class="subs-stat-value">' + formatCurrency(summary.upcomingCost) + "</span><span class=\"subs-stat-label\">Upcoming this month</span></div>";

      var list = el("subscriptions-list");
      if (!defs.length) {
        list.innerHTML = '<div class="recurring-empty"><p class="budgets-hint">No subscriptions tracked yet.</p>' +
          '<button class="btn btn-primary" data-action="open-recurring-add" type="button">Add Subscription</button></div>';
        return;
      }
      list.innerHTML = defs.map(function (d) {
        var eq = d.frequency !== "monthly" ? ' <span class="due-rel">≈ ' + formatCurrency(recurring.monthlyEquivalent(d.amount, d.frequency)) + "/mo</span>" : "";
        var html = '<div class="recurring-card">';
        html += '<div class="recurring-card-head"><span class="recurring-card-title sub-title">' + esc(d.title) + "</span>" +
          (d.status === "paused" ? '<span class="status-badge is-paused">Paused</span>' : '<span class="status-badge is-active">Active</span>') + "</div>";
        html += '<div class="recurring-card-meta">' + esc(d.category) + " &middot; " + this.frequencyLabel(d.frequency) + "</div>";
        html += '<div class="recurring-card-amount is-expense">− ' + formatCurrency(d.amount) + eq + "</div>";
        html += '<div class="recurring-card-due">Next payment: ' + (d.nextDueDate ? formatDate(d.nextDueDate) : "—") +
          (d.nextDueDate ? ' <span class="due-rel">' + this.dueRelativeLabel(daysUntil(d.nextDueDate)) + "</span>" : "") + "</div>";
        html += '<div class="recurring-card-actions">' +
          '<button type="button" class="btn btn-ghost btn-sm" data-edit-recurring="' + esc(d.id) + '">Edit</button>' +
          (d.status === "paused"
            ? '<button type="button" class="btn btn-primary btn-sm" data-toggle-recurring="' + esc(d.id) + '">Resume</button>'
            : '<button type="button" class="btn btn-ghost btn-sm" data-toggle-recurring="' + esc(d.id) + '">Pause</button>') +
          '<button type="button" class="btn btn-ghost btn-sm" data-delete-recurring="' + esc(d.id) + '">Delete</button>' +
          "</div>";
        html += "</div>";
        return html;
      }, this).join("");
    },

    renderDashboardUpcoming: function () {
      var panel = el("dashboard-upcoming");
      var body = el("dash-upcoming-body");
      if (!panel || !body) return;
      var rows = recurring.upcomingPayments();
      if (!rows.length) { panel.style.display = "none"; return; }
      panel.style.display = "";
      body.innerHTML = rows.slice(0, 4).map(function (r) {
        return (
          '<li class="recent-item">' +
            '<span class="recent-avatar" style="background:var(--paper-2);color:var(--muted)">' + esc(initials(r.title)) + "</span>" +
            '<span class="recent-main"><span class="recent-title">' + esc(r.title) + "</span>" +
            '<span class="recent-meta">' + this.dueRelativeLabel(r.daysToDue) + "</span></span>" +
            '<span class="recent-amt ' + (r.type === "income" ? "is-income" : "is-expense") + '">' +
              (r.type === "income" ? "+ " : "− ") + formatCurrency(r.amount) + "</span>" +
          "</li>"
        );
      }, this).join("");
    },

    /* -------------------- RECURRING DRAWER -------------------- */

    populateRecurringCategories: function (type, keepValue) {
      var sel = el("rf-category");
      if (!sel) return;
      var cats = storage.categoriesFor(type);
      var current = keepValue != null ? keepValue : sel.value;
      var stillValid = current === "" || cats.indexOf(current) !== -1;
      sel.innerHTML = '<option value="">Select a category</option>';
      cats.forEach(function (cat) {
        var o = document.createElement("option");
        o.value = cat; o.textContent = cat; sel.appendChild(o);
      });
      sel.value = stillValid ? current : "";
      return sel.value;
    },

    setRecurringFormType: function (type, keepValue) {
      var t = storage.normalizeType(type);
      document.querySelectorAll("[data-rf-type]").forEach(function (btn) {
        var on = btn.getAttribute("data-rf-type") === t;
        btn.classList.toggle("is-active", on);
        btn.setAttribute("aria-pressed", on ? "true" : "false");
      });
      var vendorLabel = el("rf-vendor-label");
      if (vendorLabel) vendorLabel.textContent = t === "income" ? "Source" : "Vendor / source";
      return this.populateRecurringCategories(t, keepValue);
    },

    openRecurringDrawer: function (mode, def) {
      var drawer = el("recurring-drawer");
      var overlay = el("recurring-drawer-overlay");
      var form = el("recurring-form");
      form.reset();
      el("rf-error").hidden = true;
      el("rf-error").textContent = "";

      if (mode === "edit" && def) {
        el("recurring-drawer-eyebrow").textContent = "Editing";
        el("recurring-drawer-title").textContent = "Edit recurring transaction";
        el("btn-save-recurring").textContent = "Save changes";
        el("rf-id").value = def.id;
        this.setRecurringFormType(def.type, def.category);
        el("rf-title").value = def.title || "";
        el("rf-amount").value = def.amount != null ? def.amount : "";
        el("rf-category").value = def.category || "";
        el("rf-vendor").value = def.vendor || "";
        el("rf-frequency").value = def.frequency || "monthly";
        el("rf-start-date").value = def.startDate || "";
        el("rf-next-due").value = def.nextDueDate || "";
        el("rf-subscription").checked = !!def.isSubscription;
        el("rf-status").value = def.status === "paused" ? "paused" : "active";
        el("rf-notes").value = def.notes || "";
      } else {
        el("recurring-drawer-eyebrow").textContent = "New recurring";
        el("recurring-drawer-title").textContent = "Add recurring transaction";
        el("btn-save-recurring").textContent = "Save recurring";
        el("rf-id").value = "";
        this.setRecurringFormType("expense");
        var todayStr = expenses._util.todayKey();
        el("rf-start-date").value = todayStr;
        el("rf-next-due").value = todayStr;
        el("rf-status").value = "active";
      }

      overlay.hidden = false;
      drawer.setAttribute("aria-hidden", "false");
      void drawer.offsetWidth;
      overlay.classList.add("is-shown");
      drawer.classList.add("is-open");
      setTimeout(function () { el("rf-title").focus(); }, 120);
    },

    closeRecurringDrawer: function () {
      var drawer = el("recurring-drawer");
      var overlay = el("recurring-drawer-overlay");
      drawer.classList.remove("is-open");
      overlay.classList.remove("is-shown");
      drawer.setAttribute("aria-hidden", "true");
      setTimeout(function () { overlay.hidden = true; }, 300);
    },

    isRecurringDrawerOpen: function () {
      return el("recurring-drawer").classList.contains("is-open");
    },

    setRecurringTab: function (tab) {
      document.querySelectorAll("[data-rtab]").forEach(function (btn) {
        btn.classList.toggle("is-active", btn.getAttribute("data-rtab") === tab);
      });
      el("rtab-recurring").hidden = tab !== "recurring";
      el("rtab-subscriptions").hidden = tab !== "subscriptions";
    },

    /* -------------------- DATA & BACKUP -------------------- */

    renderDataPage: function (all) {
      this.renderExportCategoryOptions(all);
      this.updateExportCount(all);
      this.renderStorageInfo();
      this.renderBackupReminder();
    },

    renderExportCategoryOptions: function (all, keepValue) {
      var sel = el("export-category");
      if (!sel) return;
      var current = keepValue != null ? keepValue : sel.value;
      var cats = {};
      all.forEach(function (t) { if (t.category) cats[t.category] = true; });
      sel.innerHTML = '<option value="">All categories</option>';
      Object.keys(cats).sort().forEach(function (cat) {
        var o = document.createElement("option");
        o.value = cat; o.textContent = cat; sel.appendChild(o);
      });
      sel.value = cats[current] ? current : "";
    },

    updateExportCount: function (all) {
      var count = el("export-count");
      if (!count) return;
      var list = all;
      var type = el("export-type").value;
      var cat = el("export-category").value;
      var range = el("export-range").value;
      if (range !== "all") list = reports.filterByDateRange(list, range, el("export-start").value, el("export-end").value);
      list = reports.filterByType(list, type);
      list = reports.filterByCategory(list, cat);
      count.textContent = "Matching transactions: " + list.length;
    },

    renderStorageInfo: function () {
      var box = el("storage-info");
      if (!box) return;
      var info = data.storageOverview();
      var size = info.sizeBytes < 1024
        ? info.sizeBytes + " B"
        : (info.sizeBytes / 1024).toFixed(1) + " KB";
      var lastBackup = info.lastBackupAt ? formatRelativeTime(info.lastBackupAt) : "Never";
      box.innerHTML =
        storageInfoRow("Transactions", String(info.transactions)) +
        storageInfoRow("Recurring transactions", String(info.recurring)) +
        storageInfoRow("Financial goals", String(info.goals)) +
        storageInfoRow("Goal contributions", String(info.contributions)) +
        storageInfoRow("Estimated data size", size) +
        storageInfoRow("Last backup", lastBackup);
    },

    renderBackupReminder: function () {
      var box = el("backup-reminder");
      if (!box) return;
      var info = data.storageOverview();
      var last = info.lastBackupAt;
      var days = last ? Math.floor((Date.now() - last) / 86400000) : null;
      if (days != null && days <= 14) {
        box.innerHTML = "Last backup: <strong>" + formatRelativeTime(last) + "</strong>.";
      } else {
        box.innerHTML = "You have not created a backup recently.<br>Last backup: <strong>" + (last ? formatRelativeTime(last) : "Never") + "</strong>.";
      }
    },

    renderImportMapping: function (headerRow, indices) {
      var box = el("import-mapping");
      if (!box) return;
      box.hidden = false;
      var fields = ["date", "title", "amount", "type", "category", "vendor", "notes"];
      var labels = { date: "Transaction date *", title: "Title", amount: "Amount *", type: "Type", category: "Category", vendor: "Vendor / source", notes: "Notes" };
      var html = '<h3 class="budget-section-title" style="margin:10px 0 8px">Map CSV columns</h3><div class="field-row">';
      fields.forEach(function (f) {
        html += '<div class="field"><label for="map-' + f + '">' + labels[f] + "</label><select id=\"map-" + f + "\">";
        html += '<option value="-1">— ignore —</option>';
        headerRow.forEach(function (h, i) {
          html += '<option value="' + i + '">' + esc(h) + "</option>";
        });
        html += "</select></div>";
      });
      html += '<div class="field"><label for="import-default-type">Default type (if missing)</label>' +
        '<select id="import-default-type"><option value="expense">Expense</option><option value="income">Income</option></select></div>';
      html += "</div>";
      box.innerHTML = html;
      fields.forEach(function (f) {
        var idx = indices[f];
        var sel = document.getElementById("map-" + f);
        if (sel && idx != null && idx >= 0) sel.value = String(idx);
      });
      box.setAttribute("data-file-type", "csv");
    },

    readImportMapping: function () {
      var fields = ["date", "title", "amount", "type", "category", "vendor", "notes"];
      var mapping = {};
      fields.forEach(function (f) {
        var sel = document.getElementById("map-" + f);
        mapping[f] = sel ? Number(sel.value) : -1;
      });
      return mapping;
    },

    renderImportPreview: function (preview, candidates, filename) {
      var box = el("import-preview");
      if (!box) return;
      box.hidden = false;
      var valid = preview.valid, invalid = preview.invalid, duplicates = preview.duplicates;
      var html = '<h3 class="budget-section-title" style="margin:10px 0 6px">Import preview</h3>';
      html += '<p class="budgets-hint">' + esc(filename || "Imported file") + " &middot; " + preview.total + " row(s) detected.</p>";
      if (!valid.length && !invalid.length && !duplicates.length) {
        html += '<p class="budgets-hint">No importable rows found.</p>';
      }
      if (valid.length) {
        html += '<div class="import-summary is-ok">Valid: ' + valid.length + "</div>";
        html += '<div class="import-table-wrap"><table class="import-table"><thead><tr><th>#</th><th>Date</th><th>Title</th><th>Type</th><th>Category</th><th>Amount</th></tr></thead><tbody>';
        valid.slice(0, 15).forEach(function (c) {
          var d = c.data;
          html += "<tr><td>" + c.rowIndex + "</td><td>" + esc(formatDate(d.date)) + "</td><td>" + esc(d.title) + "</td><td>" + esc(d.type === "income" ? "Income" : "Expense") + "</td><td>" + esc(d.category) + "</td><td>" + formatCurrency(d.amount) + "</td></tr>";
        });
        if (valid.length > 15) html += '<tr><td colspan="6" class="import-more">… and ' + (valid.length - 15) + " more</td></tr>";
        html += "</tbody></table></div>";
      }
      if (invalid.length) {
        html += '<div class="import-summary is-error">Invalid: ' + invalid.length + '</div><ul class="import-issues">';
        invalid.forEach(function (c) {
          html += '<li>Row ' + c.rowIndex + ": " + esc(c.errors.join("; ")) + "</li>";
        });
        html += "</ul>";
      }
      if (duplicates.length) {
        html += '<div class="import-summary is-warn">Duplicates (will be skipped): ' + duplicates.length + "</div>";
      }
      box.innerHTML = html;
      var btn = el("btn-do-import");
      if (btn) {
        btn.hidden = valid.length === 0;
        btn.textContent = "Import " + valid.length + " transaction" + (valid.length === 1 ? "" : "s");
        btn.setAttribute("data-valid-count", String(valid.length));
      }
    },

    renderBackupPreview: function (info) {
      var box = el("backup-preview");
      if (!box) return;
      box.hidden = false;
      var created = info.exportedAt ? "Created: " + formatRelativeTime(new Date(info.exportedAt).getTime()) : "";
      box.innerHTML =
        '<h3 class="budget-section-title" style="margin:10px 0 6px">Backup preview</h3>' +
        '<div class="storage-info">' +
          storageInfoRow("Transactions", String(info.transactions)) +
          storageInfoRow("Budgets", String(info.budgets)) +
          storageInfoRow("Financial goals", String(info.financialGoals)) +
          storageInfoRow("Goal contributions", String(info.goalContributions)) +
          storageInfoRow("Recurring", String(info.recurringTransactions)) +
        "</div>" +
        '<p class="budgets-hint">Version ' + esc(String(info.version)) + " &middot; " + created + "</p>";
    },
  };

  function actionButtons(id) {
    return (
      '<span class="row-actions">' +
        '<button class="act-btn edit" type="button" data-edit="' + esc(id) + '" aria-label="Edit transaction" title="Edit">' +
          '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L18.5 9.5a2.12 2.12 0 00-3-3L5 17v3z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>' +
        "</button>" +
        '<button class="act-btn del" type="button" data-delete="' + esc(id) + '" aria-label="Delete transaction" title="Delete">' +
          '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13M10 11v6M14 11v6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
        "</button>" +
      "</span>"
    );
  }

  function buildTable(rows) {
    var body = rows.map(function (e) {
      var type = recordType(e);
      var rel = relativeDay(e.date);
      var notes = e.notes ? '<div class="cell-notes">' + esc(e.notes) + "</div>" : "";
      var amtClass = type === "income" ? "is-income" : "is-expense";
    return (
      "<tr>" +
        "<td>" + typeBadge(type) + "</td>" +
        '<td class="cell-date">' + formatDate(e.date) +
          (rel ? '<span class="date-rel">' + rel + "</span>" : "") + "</td>" +
        "<td><div class=\"cell-title\">" + esc(e.title) + "</div>" + notes + "</td>" +
        "<td>" + badge(e.category) + "</td>" +
        '<td class="cell-vendor">' + (e.vendor ? esc(e.vendor) : '<span style="color:var(--muted)">—</span>') + "</td>" +
        '<td class="col-amt cell-amt ' + amtClass + '">' + signedCurrency(e.amount, type) + "</td>" +
        '<td class="col-sync">' + syncBadge(e) + "</td>" +
        '<td class="col-act">' + actionButtons(e.id) + "</td>" +
      "</tr>"
    );
  }).join("");

    return (
      '<div class="table-wrap only-desktop">' +
        '<table class="exp-table">' +
          "<thead><tr>" +
            "<th>Type</th><th>Date</th><th>Title</th><th>Category</th><th>Store / source</th>" +
            '<th class="col-amt">Amount</th><th class="col-sync">Sync</th><th class="col-act">Actions</th>' +
          "</tr></thead>" +
          "<tbody>" + body + "</tbody>" +
        "</table>" +
      "</div>"
    );
  }

  function buildCards(rows) {
    var cards = rows.map(function (e) {
      var type = recordType(e);
      var rel = relativeDay(e.date);
      var notes = e.notes ? '<div class="exp-card-notes">' + esc(e.notes) + "</div>" : "";
      var amtClass = type === "income" ? "is-income" : "is-expense";
      return (
        '<article class="exp-card">' +
          '<div class="exp-card-top">' +
            '<div><div class="exp-card-title">' + esc(e.title) + "</div>" +
              '<div class="exp-card-meta">' + typeBadge(type) + badge(e.category) +
                (e.vendor ? "<span>" + esc(e.vendor) + "</span>" : "") + "</div>" +
            "</div>" +
            '<div class="exp-card-amt ' + amtClass + '">' + signedCurrency(e.amount, type) + "</div>" +
          "</div>" +
          notes +
          '<div class="exp-card-foot">' +
            '<span class="exp-card-date">' + formatDate(e.date) + (rel ? " · " + rel : "") + "</span>" +
            syncBadge(e) +
            actionButtons(e.id) +
          "</div>" +
        "</article>"
      );
    }).join("");
    return '<div class="card-list only-mobile">' + cards + "</div>";
  }

  ET.ui = ui;
})(window, document);
