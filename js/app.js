/* =========================================================================
   app.js — bootstrap & event wiring
   Ties storage + transactions + ui together: routing, form submit, edit/delete,
   live filtering, sample data. This is the only file that owns app state
   (the current filter values) and orchestrates re-renders.

   Attaches to: window.ET.app
   ========================================================================= */
(function (global, document) {
  "use strict";

  var ET = (global.ET = global.ET || {});
  var expenses = ET.expenses;
  var ui = ET.ui;

  var el = function (id) { return document.getElementById(id); };

  var state = {
    view: "dashboard",
    navKey: "dashboard",
    filters: { search: "", category: "", month: "", type: "all" },
    pendingDeleteId: null
  };

  function refresh(opts) {
    opts = opts || {};
    var all = expenses.all();

    var monthValue = ui.populateMonthFilter(all, state.filters.month);
    state.filters.month = monthValue;
    var catValue = ui.populateFilterCategories(state.filters.type, state.filters.category);
    state.filters.category = catValue;
    ui.setTypeFilterChips(state.filters.type);

    ui.renderDashboard(all);

    var filtered = expenses.filter(all, state.filters);
    ui.renderList(filtered, all.length);

    if (opts.animateDashboard) {
      var content = el("dashboard-content");
      if (content && !content.hidden) {
        content.classList.remove("animate-in");
        void content.offsetWidth;
        content.classList.add("animate-in");
      }
    }
  }

  function navKeyForFilters() {
    if (state.view === "dashboard") return "dashboard";
    if (state.filters.type === "income") return "income";
    if (state.filters.type === "expense") return "expenses";
    return "transactions";
  }

  function goToView(view) {
    if (view === "income") {
      state.view = "transactions";
      state.navKey = "income";
      state.filters.type = "income";
      ui.setView("transactions", "income");
      closeSidebar();
      refresh();
      return;
    }
    if (view === "expenses") {
      state.view = "transactions";
      state.navKey = "expenses";
      state.filters.type = "expense";
      ui.setView("transactions", "expenses");
      closeSidebar();
      refresh();
      return;
    }
    if (view === "transactions") {
      state.view = "transactions";
      state.navKey = "transactions";
      state.filters.type = "all";
      ui.setView("transactions", "transactions");
      closeSidebar();
      refresh();
      return;
    }
    state.view = "dashboard";
    state.navKey = "dashboard";
    ui.setView("dashboard", "dashboard");
    closeSidebar();
    refresh({ animateDashboard: true });
  }

  function handleSubmit(e) {
    e.preventDefault();
    var payload = {
      type: el("field-type").value,
      title: el("field-title").value,
      amount: el("field-amount").value,
      category: el("field-category").value,
      vendor: el("field-vendor").value,
      date: el("field-date").value,
      notes: el("field-notes").value
    };

    var errors = expenses.validate(payload);
    if (Object.keys(errors).length > 0) {
      ui.showFieldErrors(errors);
      return;
    }

    var id = el("field-id").value;
    if (id) {
      expenses.updateTransaction(id, payload);
      ui.closeDrawer();
      refresh();
      ui.toast("Transaction updated");
    } else {
      expenses.addTransaction(payload);
      ui.closeDrawer();
      refresh();
      ui.toast(payload.type === "income" ? "Income added" : "Expense added");
      var nlInput = el("nl-input");
      if (nlInput && nlInput.value) nlInput.value = "";
    }
  }

  function handleListClick(e) {
    var editBtn = e.target.closest("[data-edit]");
    if (editBtn) {
      var editId = editBtn.getAttribute("data-edit");
      var record = expenses.get(editId);
      if (record) ui.openDrawer("edit", record);
      return;
    }
    var delBtn = e.target.closest("[data-delete]");
    if (delBtn) {
      state.pendingDeleteId = delBtn.getAttribute("data-delete");
      var rec = expenses.get(state.pendingDeleteId);
      var msg = rec
        ? 'Delete "' + rec.title + '"? This can\'t be undone.'
        : "This will permanently remove the entry. This can't be undone.";
      ui.openConfirm(msg);
    }
  }

  function confirmDelete() {
    if (!state.pendingDeleteId) return;
    var ok = expenses.removeTransaction(state.pendingDeleteId);
    state.pendingDeleteId = null;
    ui.closeConfirm();
    if (ok) {
      refresh();
      ui.toast("Transaction deleted", "info");
    } else {
      ui.toast("Could not delete transaction", "error");
    }
  }

  function applyFilterRender() {
    var all = expenses.all();
    state.filters.category = ui.populateFilterCategories(state.filters.type, state.filters.category);
    ui.setTypeFilterChips(state.filters.type);
    var filtered = expenses.filter(all, state.filters);
    ui.renderList(filtered, all.length);
    state.navKey = navKeyForFilters();
    ui.setView(state.view === "dashboard" ? "dashboard" : "transactions", state.navKey);
  }

  function clearFilters() {
    state.filters.search = "";
    state.filters.category = "";
    state.filters.month = "";
    el("search-input").value = "";
    el("filter-category").value = "";
    el("filter-month").value = "";
    applyFilterRender();
  }

  function openAddDrawer() {
    var defaultType = state.filters.type === "income" ? "income" : "expense";
    ui.openDrawer("add", null, defaultType);
  }

  function openSidebar() {
    el("sidebar").classList.add("is-open");
    var bd = el("sidebar-backdrop");
    bd.hidden = false;
    void bd.offsetWidth;
    bd.classList.add("is-shown");
    el("btn-menu").setAttribute("aria-expanded", "true");
  }
  function closeSidebar() {
    el("sidebar").classList.remove("is-open");
    var bd = el("sidebar-backdrop");
    bd.classList.remove("is-shown");
    setTimeout(function () { bd.hidden = true; }, 300);
    el("btn-menu").setAttribute("aria-expanded", "false");
  }

  function loadSamples() {
    expenses.loadSamples();
    refresh({ animateDashboard: true });
    ui.toast("Sample data loaded");
  }

  /* --------------------- smart natural-language entry --------------------- */
  function handleAnalyze() {
    var input = el("nl-input");
    var errBox = el("nl-error");
    var text = (input.value || "").trim();

    errBox.hidden = true;
    errBox.textContent = "";

    if (!text) {
      errBox.textContent = "Describe the transaction first, e.g. \u201CI bought sugar from Carrefour for 12 AED\u201D.";
      errBox.hidden = false;
      input.focus();
      return;
    }

    ET.parser.parseTransaction(text).then(function (result) {
      if (result.error) {
        errBox.textContent = result.error;
        errBox.hidden = false;
        return;
      }
      ui.openDrawer("review", result.data, null, result.confidence);
    });
  }

  function pickExample(button) {
    el("nl-input").value = button.getAttribute("data-example") || "";
    var errBox = el("nl-error");
    errBox.hidden = true;
    errBox.textContent = "";
    el("nl-input").focus();
  }

  function wire() {
    document.querySelectorAll(".nav-item[data-view]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        goToView(btn.getAttribute("data-view"));
      });
    });
    document.querySelectorAll("[data-view-jump]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        goToView(btn.getAttribute("data-view-jump"));
      });
    });

    el("btn-add-expense").addEventListener("click", openAddDrawer);
    el("btn-add-mobile").addEventListener("click", openAddDrawer);

    document.querySelectorAll('[data-action="open-add"]').forEach(function (b) {
      b.addEventListener("click", openAddDrawer);
    });
    document.querySelectorAll('[data-action="load-sample"]').forEach(function (b) {
      b.addEventListener("click", loadSamples);
    });

    // Smart natural-language entry
    el("btn-analyze").addEventListener("click", handleAnalyze);
    el("nl-input").addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleAnalyze();
      }
    });
    document.querySelectorAll("[data-example]").forEach(function (chip) {
      chip.addEventListener("click", function () {
        pickExample(chip);
      });
    });

    el("expense-form").addEventListener("submit", handleSubmit);
    el("btn-close-drawer").addEventListener("click", ui.closeDrawer);
    el("btn-cancel-drawer").addEventListener("click", ui.closeDrawer);
    el("drawer-overlay").addEventListener("click", ui.closeDrawer);

    document.querySelectorAll("[data-form-type]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var nextType = btn.getAttribute("data-form-type");
        var keep = el("field-category").value;
        ui.setFormType(nextType, keep);
        var f = el("field-category").closest(".field");
        if (f && f.classList.contains("has-error") && el("field-category").value) {
          f.classList.remove("has-error");
          el("field-category").setAttribute("aria-invalid", "false");
          var msg = el("err-category");
          if (msg) { msg.hidden = true; msg.textContent = ""; }
        }
      });
    });

    ["title", "amount", "category", "date"].forEach(function (key) {
      var input = el("field-" + key);
      var evt = input.tagName === "SELECT" ? "change" : "input";
      input.addEventListener(evt, function () {
        var f = input.closest(".field");
        if (f && f.classList.contains("has-error")) {
          f.classList.remove("has-error");
          input.setAttribute("aria-invalid", "false");
          var msg = el("err-" + key);
          if (msg) { msg.hidden = true; msg.textContent = ""; }
        }
      });
    });

    el("expense-list-container").addEventListener("click", handleListClick);

    el("btn-confirm-delete").addEventListener("click", confirmDelete);
    el("btn-cancel-delete").addEventListener("click", function () {
      state.pendingDeleteId = null;
      ui.closeConfirm();
    });
    el("confirm-overlay").addEventListener("click", function (e) {
      if (e.target === el("confirm-overlay")) {
        state.pendingDeleteId = null;
        ui.closeConfirm();
      }
    });

    document.querySelectorAll("[data-type-filter]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        state.filters.type = btn.getAttribute("data-type-filter") || "all";
        applyFilterRender();
      });
    });
    el("search-input").addEventListener("input", function (e) {
      state.filters.search = e.target.value;
      applyFilterRender();
    });
    el("filter-category").addEventListener("change", function (e) {
      state.filters.category = e.target.value;
      applyFilterRender();
    });
    el("filter-month").addEventListener("change", function (e) {
      state.filters.month = e.target.value;
      applyFilterRender();
    });
    el("btn-clear-filters").addEventListener("click", clearFilters);
    el("btn-clear-filters-2").addEventListener("click", clearFilters);

    el("btn-menu").addEventListener("click", openSidebar);
    el("sidebar-backdrop").addEventListener("click", closeSidebar);

    document.addEventListener("keydown", function (e) {
      if (e.key !== "Escape") return;
      if (ui.isConfirmOpen()) { state.pendingDeleteId = null; ui.closeConfirm(); }
      else if (ui.isDrawerOpen()) { ui.closeDrawer(); }
      else if (el("sidebar").classList.contains("is-open")) { closeSidebar(); }
    });
  }

  function init() {
    ui.populateCategorySelects();
    wire();
    ui.setView("dashboard", "dashboard");
    refresh({ animateDashboard: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  ET.app = { refresh: refresh, goToView: goToView, _state: state };
})(window, document);
