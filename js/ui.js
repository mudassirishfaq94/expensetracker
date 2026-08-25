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

  function typeBadge(type) {
    if (type === "income") {
      return '<span class="type-badge income"><span class="type-sign income" aria-hidden="true">+</span> Income</span>';
    }
    return '<span class="type-badge expense"><span class="type-sign expense" aria-hidden="true">−</span> Expense</span>';
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
      var isDash = view === "dashboard";
      el("view-dashboard").hidden = !isDash;
      el("view-expenses").hidden = isDash;

      var titles = {
        dashboard: { title: "Dashboard", eyebrow: "Overview" },
        transactions: { title: "Transactions", eyebrow: "All activity" },
        income: { title: "Income", eyebrow: "Incoming money" },
        expenses: { title: "Expenses", eyebrow: "Outgoing money" }
      };
      var key = navKey || view;
      var meta = titles[key] || titles.transactions;
      el("view-title").textContent = meta.title;
      el("view-eyebrow").textContent = meta.eyebrow;

      var items = document.querySelectorAll(".nav-item[data-view]");
      items.forEach(function (btn) {
        btn.classList.toggle("is-active", btn.getAttribute("data-view") === key);
      });
    }
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
          '<td class="col-act">' + actionButtons(e.id) + "</td>" +
        "</tr>"
      );
    }).join("");

    return (
      '<div class="table-wrap only-desktop">' +
        '<table class="exp-table">' +
          "<thead><tr>" +
            "<th>Type</th><th>Date</th><th>Title</th><th>Category</th><th>Store / source</th>" +
            '<th class="col-amt">Amount</th><th class="col-act">Actions</th>' +
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
            actionButtons(e.id) +
          "</div>" +
        "</article>"
      );
    }).join("");
    return '<div class="card-list only-mobile">' + cards + "</div>";
  }

  ET.ui = ui;
})(window, document);
