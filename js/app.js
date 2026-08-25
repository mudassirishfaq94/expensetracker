/* =========================================================================
   app.js — bootstrap & event wiring
   Ties storage + expenses + ui together: routing, form submit, edit/delete,
   live filtering, sample data. This is the only file that owns app state
   (the current filter values) and orchestrates re-renders.

   Attaches to: window.ET.app
   ========================================================================= */
(function (global, document) {
  "use strict";

  var ET = (global.ET = global.ET || {});
  var storage = ET.storage;
  var expenses = ET.expenses;
  var ui = ET.ui;

  var el = function (id) { return document.getElementById(id); };

  var state = {
    view: "dashboard",
    filters: { search: "", category: "", month: "" },
    pendingDeleteId: null
  };

  /* -------- central re-render: reads storage, repaints everything -------- */
  function refresh(opts) {
    opts = opts || {};
    var all = expenses.all();

    // keep the month filter options in sync with the data
    var monthValue = ui.populateMonthFilter(all, state.filters.month);
    state.filters.month = monthValue;

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

  /* ---------------------------- routing ---------------------------- */
  function goToView(view) {
    state.view = view;
    ui.setView(view);
    closeSidebar();
    if (view === "dashboard") refresh({ animateDashboard: true });
  }

  /* ------------------------- form submit --------------------------- */
  function handleSubmit(e) {
    e.preventDefault();
    var payload = {
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
      expenses.update(id, payload);
      ui.closeDrawer();
      refresh();
      ui.toast("Expense updated");
    } else {
      expenses.create(payload);
      ui.closeDrawer();
      // the hero number counts up on its own, which reads as "it landed"
      refresh();
      ui.toast("Expense added");
    }
  }

  /* --------------------- edit / delete (delegated) --------------------- */
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
    var ok = expenses.remove(state.pendingDeleteId);
    state.pendingDeleteId = null;
    ui.closeConfirm();
    if (ok) {
      refresh();
      ui.toast("Expense deleted", "info");
    } else {
      ui.toast("Could not delete expense", "error");
    }
  }

  /* --------------------------- filtering --------------------------- */
  function applyFilterRender() {
    var all = expenses.all();
    var filtered = expenses.filter(all, state.filters);
    ui.renderList(filtered, all.length);
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

  /* --------------------------- sidebar (mobile) --------------------------- */
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

  /* ------------------------- sample data --------------------------- */
  function loadSamples() {
    expenses.loadSamples();
    refresh({ animateDashboard: true });
    ui.toast("Sample data loaded");
  }

  /* ----------------------------- wiring ----------------------------- */
  function wire() {
    // nav
    document.querySelectorAll(".nav-item[data-view]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        goToView(btn.getAttribute("data-view"));
      });
    });
    // "View all" jump from dashboard recent list
    document.querySelectorAll("[data-view-jump]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        goToView(btn.getAttribute("data-view-jump"));
      });
    });

    // add expense (topbar + mobile bar)
    el("btn-add-expense").addEventListener("click", function () { ui.openDrawer("add"); });
    el("btn-add-mobile").addEventListener("click", function () { ui.openDrawer("add"); });

    // empty-state + sample actions (there are several such buttons)
    document.querySelectorAll('[data-action="open-add"]').forEach(function (b) {
      b.addEventListener("click", function () { ui.openDrawer("add"); });
    });
    document.querySelectorAll('[data-action="load-sample"]').forEach(function (b) {
      b.addEventListener("click", loadSamples);
    });

    // drawer controls
    el("expense-form").addEventListener("submit", handleSubmit);
    el("btn-close-drawer").addEventListener("click", ui.closeDrawer);
    el("btn-cancel-drawer").addEventListener("click", ui.closeDrawer);
    el("drawer-overlay").addEventListener("click", ui.closeDrawer);

    // clear a field error as soon as the user starts fixing it
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

    // list actions (event delegation on the container)
    el("expense-list-container").addEventListener("click", handleListClick);

    // confirm modal
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

    // filters (instant)
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

    // sidebar (mobile)
    el("btn-menu").addEventListener("click", openSidebar);
    el("sidebar-backdrop").addEventListener("click", closeSidebar);

    // keyboard: Esc closes whatever is open
    document.addEventListener("keydown", function (e) {
      if (e.key !== "Escape") return;
      if (ui.isConfirmOpen()) { state.pendingDeleteId = null; ui.closeConfirm(); }
      else if (ui.isDrawerOpen()) { ui.closeDrawer(); }
      else if (el("sidebar").classList.contains("is-open")) { closeSidebar(); }
    });
  }

  /* ------------------------------ init ------------------------------ */
  function init() {
    ui.populateCategorySelects();
    wire();
    ui.setView("dashboard");
    refresh({ animateDashboard: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  ET.app = { refresh: refresh, goToView: goToView, _state: state };
})(window, document);
