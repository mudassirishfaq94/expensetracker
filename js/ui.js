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

  /* ---------------- tiny helpers ---------------- */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function el(id) { return document.getElementById(id); }

  /* Escape user-supplied text before putting it in innerHTML. */
  function esc(str) {
    if (str == null) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  /* AED 1,250.00 */
  function formatCurrency(amount) {
    var n = Number(amount) || 0;
    var s = n.toLocaleString("en-AE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return storage.DEFAULT_CURRENCY + " " + s;
  }

  /* "25 Aug 2026" */
  function formatDate(dateStr) {
    if (!dateStr) return "";
    var parts = dateStr.split("-");
    if (parts.length !== 3) return dateStr;
    var d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    var months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    return d.getDate() + " " + months[d.getMonth()] + " " + d.getFullYear();
  }

  /* "Today", "Yesterday", or "3 days ago" for recency hints. */
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

  function badge(category) {
    var slug = storage.categorySlug(category);
    return '<span class="badge ' + slug + '"><span class="dot"></span>' + esc(category) + "</span>";
  }

  /* ---------------- count-up animation for the hero number ---------------- */
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
      var eased = 1 - Math.pow(1 - p, 3); // easeOutCubic
      node.textContent = formatCurrency(from + (to - from) * eased);
      if (p < 1) _heroRAF = requestAnimationFrame(step);
    }
    _heroRAF = requestAnimationFrame(step);
  }

  var ui = {
    esc: esc,
    formatCurrency: formatCurrency,
    formatDate: formatDate,

    /* Populate the category <select>s (form + filter) once at startup. */
    populateCategorySelects: function () {
      var formSel = el("field-category");
      var filterSel = el("filter-category");
      storage.CATEGORIES.forEach(function (cat) {
        var o1 = document.createElement("option");
        o1.value = cat; o1.textContent = cat;
        formSel.appendChild(o1);

        var o2 = document.createElement("option");
        o2.value = cat; o2.textContent = cat;
        filterSel.appendChild(o2);
      });
    },

    /* Rebuild the month filter to reflect months that actually have data. */
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
      // restore selection if still valid
      var stillValid = current === "" || months.some(function (m) { return m.key === current; });
      sel.value = stillValid ? current : "";
      return sel.value;
    },

    /* -------------------- DASHBOARD -------------------- */
    renderDashboard: function (list) {
      var hasData = list.length > 0;
      el("dashboard-empty").hidden = hasData;
      el("dashboard-content").hidden = !hasData;
      if (!hasData) return;

      var s = expenses.stats(list);

      el("hero-month-label").textContent = s.monthLabel;
      el("hero-count-chip").textContent =
        s.monthCount + (s.monthCount === 1 ? " expense" : " expenses");
      animateHero(el("stat-month"), s.totalThisMonth);
      el("stat-today-inline").textContent = formatCurrency(s.todaySpending);

      el("stat-today").textContent = formatCurrency(s.todaySpending);
      el("stat-today-foot").textContent = s.todayCount === 0
        ? "No expenses today"
        : s.todayCount + (s.todayCount === 1 ? " expense today" : " expenses today");

      el("stat-count").textContent = String(s.totalCount);
      el("stat-count-foot").textContent = "All time";

      if (s.largest) {
        el("stat-largest").textContent = formatCurrency(s.largest.amount);
        el("stat-largest-foot").textContent = esc(s.largest.title) + " · " + formatDate(s.largest.date);
      } else {
        el("stat-largest").textContent = formatCurrency(0);
        el("stat-largest-foot").textContent = "—";
      }

      this.renderCategoryBreakdown(list, s);
      this.renderRecent(list);
    },

    renderCategoryBreakdown: function (list, s) {
      var container = el("category-breakdown");
      var rows = expenses.spendingByCategory(list);
      el("cat-note").textContent = s.monthLabel;

      if (rows.length === 0) {
        container.innerHTML =
          '<p class="stat-foot" style="padding:6px 2px">Nothing recorded this month yet.</p>';
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
        var slug = storage.categorySlug(e.category);
        var meta = [e.category, e.vendor].filter(Boolean).join(" · ");
        return (
          '<li class="recent-item">' +
            '<span class="recent-avatar ' + slug + '" style="background:var(--bg);color:var(--fg)">' + esc(initials(e.title)) + "</span>" +
            '<span class="recent-main">' +
              '<span class="recent-title">' + esc(e.title) + "</span>" +
              '<span class="recent-meta">' + esc(meta) + "</span>" +
            "</span>" +
            '<span class="recent-amt">' + formatCurrency(e.amount) + "</span>" +
          "</li>"
        );
      }).join("");
    },

    /* -------------------- EXPENSE LIST -------------------- */
    /*
     * Renders either the table (desktop) or cards (mobile) — both are in the
     * DOM and toggled by CSS media queries, so we build one markup string
     * that contains a .table-wrap AND a .card-list.
     * `total` filters state so we can show the right empty view.
     */
    renderList: function (filtered, allCount) {
      var container = el("expense-list-container");
      var emptyAll = el("expenses-empty");
      var emptyNoResults = el("expenses-no-results");

      // No expenses stored at all
      if (allCount === 0) {
        container.innerHTML = "";
        emptyAll.hidden = false;
        emptyNoResults.hidden = true;
        el("result-count").textContent = "0 expenses";
        el("result-total").textContent = "";
        return;
      }
      emptyAll.hidden = true;

      // Have data, but current filters match nothing
      if (filtered.length === 0) {
        container.innerHTML = "";
        emptyNoResults.hidden = false;
        el("result-count").textContent = "No matches";
        el("result-total").textContent = "";
        return;
      }
      emptyNoResults.hidden = true;

      var sorted = expenses.sortNewestFirst(filtered);

      // result meta
      el("result-count").textContent =
        sorted.length + (sorted.length === 1 ? " expense" : " expenses");
      var sum = sorted.reduce(function (acc, e) { return acc + (Number(e.amount) || 0); }, 0);
      el("result-total").textContent = "Total " + formatCurrency(sum);

      container.innerHTML = buildTable(sorted) + buildCards(sorted);
    },

    /* -------------------- DRAWER (add / edit) -------------------- */
    openDrawer: function (mode, expense) {
      var drawer = el("drawer");
      var overlay = el("drawer-overlay");
      var form = el("expense-form");

      form.reset();
      ui.clearFieldErrors();

      if (mode === "edit" && expense) {
        el("drawer-eyebrow").textContent = "Editing";
        el("drawer-title").textContent = "Edit expense";
        el("btn-save").textContent = "Save changes";
        el("field-id").value = expense.id;
        el("field-title").value = expense.title || "";
        el("field-amount").value = expense.amount != null ? expense.amount : "";
        el("field-category").value = expense.category || "";
        el("field-vendor").value = expense.vendor || "";
        el("field-date").value = expense.date || "";
        el("field-notes").value = expense.notes || "";
      } else {
        el("drawer-eyebrow").textContent = "New entry";
        el("drawer-title").textContent = "Add expense";
        el("btn-save").textContent = "Save expense";
        el("field-id").value = "";
        el("field-date").value = expenses._util.todayKey(); // default to today
      }

      overlay.hidden = false;
      drawer.setAttribute("aria-hidden", "false");
      // force reflow so the transition runs
      void drawer.offsetWidth;
      overlay.classList.add("is-shown");
      drawer.classList.add("is-open");
      setTimeout(function () { el("field-title").focus(); }, 120);
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

    /* -------------------- field errors -------------------- */
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

    /* -------------------- confirm modal -------------------- */
    openConfirm: function (message) {
      var overlay = el("confirm-overlay");
      if (message) el("confirm-text").textContent = message;
      overlay.hidden = false;
      void overlay.offsetWidth;
      overlay.classList.add("is-shown");
      setTimeout(function () { el("btn-confirm-delete").focus(); }, 60);
    },
    closeConfirm: function () {
      var overlay = el("confirm-overlay");
      overlay.classList.remove("is-shown");
      setTimeout(function () { overlay.hidden = true; }, 200);
    },
    isConfirmOpen: function () {
      return !el("confirm-overlay").hidden;
    },

    /* -------------------- toasts -------------------- */
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
    setView: function (view) {
      var isDash = view === "dashboard";
      el("view-dashboard").hidden = !isDash;
      el("view-expenses").hidden = isDash;

      el("view-title").textContent = isDash ? "Dashboard" : "Expenses";
      el("view-eyebrow").textContent = isDash ? "Overview" : "All transactions";

      var items = document.querySelectorAll(".nav-item[data-view]");
      items.forEach(function (btn) {
        btn.classList.toggle("is-active", btn.getAttribute("data-view") === view);
      });
    }
  };

  /* ---------------- markup builders (module-private) ---------------- */
  function actionButtons(id) {
    return (
      '<span class="row-actions">' +
        '<button class="act-btn edit" type="button" data-edit="' + esc(id) + '" aria-label="Edit expense" title="Edit">' +
          '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L18.5 9.5a2.12 2.12 0 00-3-3L5 17v3z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>' +
        "</button>" +
        '<button class="act-btn del" type="button" data-delete="' + esc(id) + '" aria-label="Delete expense" title="Delete">' +
          '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13M10 11v6M14 11v6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
        "</button>" +
      "</span>"
    );
  }

  function buildTable(rows) {
    var body = rows.map(function (e) {
      var rel = relativeDay(e.date);
      var notes = e.notes ? '<div class="cell-notes">' + esc(e.notes) + "</div>" : "";
      return (
        "<tr>" +
          '<td class="cell-date">' + formatDate(e.date) +
            (rel ? '<span class="date-rel">' + rel + "</span>" : "") + "</td>" +
          "<td><div class=\"cell-title\">" + esc(e.title) + "</div>" + notes + "</td>" +
          "<td>" + badge(e.category) + "</td>" +
          '<td class="cell-vendor">' + (e.vendor ? esc(e.vendor) : '<span style="color:var(--muted)">—</span>') + "</td>" +
          '<td class="col-amt cell-amt">' + formatCurrency(e.amount) + "</td>" +
          '<td class="col-act">' + actionButtons(e.id) + "</td>" +
        "</tr>"
      );
    }).join("");

    return (
      '<div class="table-wrap only-desktop">' +
        '<table class="exp-table">' +
          "<thead><tr>" +
            "<th>Date</th><th>Item</th><th>Category</th><th>Store</th>" +
            '<th class="col-amt">Amount</th><th class="col-act">Actions</th>' +
          "</tr></thead>" +
          "<tbody>" + body + "</tbody>" +
        "</table>" +
      "</div>"
    );
  }

  function buildCards(rows) {
    var cards = rows.map(function (e) {
      var rel = relativeDay(e.date);
      var notes = e.notes ? '<div class="exp-card-notes">' + esc(e.notes) + "</div>" : "";
      return (
        '<article class="exp-card">' +
          '<div class="exp-card-top">' +
            '<div><div class="exp-card-title">' + esc(e.title) + "</div>" +
              '<div class="exp-card-meta">' + badge(e.category) +
                (e.vendor ? "<span>" + esc(e.vendor) + "</span>" : "") + "</div>" +
            "</div>" +
            '<div class="exp-card-amt">' + formatCurrency(e.amount) + "</div>" +
          "</div>" +
          notes +
          '<div class="exp-card-foot">' +
            '<span class="exp-card-date">' + formatDate(e.date) + (rel ? " · " + rel : "") + "</span>" +
            actionButtons(e.id) +
          "</div>" +
        "</article>"
      );
    }).join("");
    return '<div class="card-list only-mobile">' + cards + "</div>";
  }

  ET.ui = ui;
})(window, document);
