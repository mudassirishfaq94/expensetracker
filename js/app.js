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

  function pad2(n) { return String(n).padStart(2, "0"); }
  function todayKeyOf(d) {
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }

  var state = {
    view: "dashboard",
    navKey: "dashboard",
    filters: { search: "", category: "", month: "", type: "all" },
    reportFilters: { range: "this-month", type: "all", category: "", start: "", end: "" },
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

    if (state.view === "sheets") {
      ui.renderSheetsPage();
    } else if (state.view === "reports") {
      var reportCat = ui.populateReportCategories(all, state.reportFilters.category);
      state.reportFilters.category = reportCat;
      ui.renderReportsPage(all, state.reportFilters);
    } else {
      ui.renderDashboard(all);
    }

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
    if (state.view === "sheets") return "sheets";
    if (state.view === "reports") return "reports";
    if (state.filters.type === "income") return "income";
    if (state.filters.type === "expense") return "expenses";
    return "transactions";
  }

  function goToView(view) {
    if (view === "reports") {
      state.view = "reports";
      state.navKey = "reports";
      ui.setView("reports", "reports");
      ui.setReportRangeChips(state.reportFilters.range);
      ui.setReportTypeChips(state.reportFilters.type);
      closeSidebar();
      refresh();
      return;
    }
    if (view === "sheets") {
      state.view = "sheets";
      state.navKey = "sheets";
      ui.setView("sheets", "sheets");
      ui.renderSheetsPage();
      closeSidebar();
      return;
    }
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
      var updated = expenses.updateTransaction(id, payload);
      ui.closeDrawer();
      refresh();
      ui.toast("Transaction updated");
      attemptSync(updated);
    } else {
      var created = expenses.addTransaction(payload);
      ui.closeDrawer();
      refresh();
      ui.toast(payload.type === "income" ? "Income added" : "Expense added");
      attemptSync(created);
      var nlInput = el("nl-input");
      if (nlInput && nlInput.value) nlInput.value = "";
    }
  }

  function handleListClick(e) {
    var retryBtn = e.target.closest("[data-retry-sync]");
    if (retryBtn) {
      var rid = retryBtn.getAttribute("data-retry-sync");
      var rec = expenses.get(rid);
      if (rec) {
        ET.sheets.syncTransaction(rec).then(function (r) {
          refresh();
          ui.toast(r.success ? "Synced to Google Sheets." : "Sync failed — try again later.", r.success ? "success" : "error");
        });
      }
      return;
    }
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

  function confirmCurrentAction() {
    if (state.pendingAction) {
      var fn = state.pendingAction;
      state.pendingAction = null;
      ui.closeConfirm();
      fn();
      return;
    }
    confirmDelete();
  }

  function confirmDelete() {
    if (!state.pendingDeleteId) return;
    var id = state.pendingDeleteId;
    state.pendingDeleteId = null;
    var ok = expenses.removeTransaction(id);
    ui.closeConfirm();
    if (!ok) {
      ui.toast("Could not delete transaction", "error");
      return;
    }
    refresh();
    ui.toast("Transaction deleted", "info");
    if (ET.sheets.isConnected()) {
      ET.sheets.deleteRemoteTransaction(id).then(function (r) {
        if (!r.success && !r.skipped) {
          ET.sheets.queueRemoteDelete(id);
          ui.toast("Could not remove it from Google Sheets. It will be retried.", "error");
        }
      });
    }
  }

  function applyFilterRender() {
    var all = expenses.all();
    state.filters.category = ui.populateFilterCategories(state.filters.type, state.filters.category);
    ui.setTypeFilterChips(state.filters.type);
    var filtered = expenses.filter(all, state.filters);
    ui.renderList(filtered, all.length);
    state.navKey = navKeyForFilters();
    var view = state.view === "dashboard" ? "dashboard"
      : state.view === "sheets" ? "sheets"
      : state.view === "reports" ? "reports"
      : "transactions";
    ui.setView(view, state.navKey);
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

  function renderReports() {
    var all = expenses.all();
    var cat = ui.populateReportCategories(all, state.reportFilters.category);
    state.reportFilters.category = cat;
    ui.renderReportsPage(all, state.reportFilters);
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

  /* --------------------- Google Sheets sync helpers --------------------- */

  function attemptSync(record) {
    if (!record) return;
    if (!ET.sheets.isConnected()) return;
    ET.sheets.syncTransaction(record).then(function (r) {
      refresh();
      if (!r.success && !r.skipped) {
        ui.toast("Saved locally, but could not sync to Google Sheets.", "error");
      }
    });
  }

  function readConfigFromForm() {
    return {
      webAppUrl: (el("sheets-url").value || "").trim(),
      spreadsheetName: (el("sheets-spreadsheet").value || "").trim(),
      sheetName: (el("sheets-sheet").value || "Transactions").trim()
    };
  }

  function testConnection() {
    var cfg = readConfigFromForm();
    if (!cfg.webAppUrl) {
      ui.showSheetsError("Please paste your Web App URL.");
      return;
    }
    if (!ET.sheets.validateUrl(cfg.webAppUrl)) {
      ui.showSheetsError("Invalid Web App URL.");
      return;
    }
    ui.hideSheetsError();
    ui.setSheetsStatus("testing");
    ET.sheets.testConnection(cfg).then(function (r) {
      if (r.success) {
        cfg.lastTestOk = true;
        cfg.lastError = null;
        ET.sheets.saveConfig(cfg);
        ui.toast("Google Sheets connected successfully.", "success");
        ui.renderSheetsPage();
        refresh();
      } else {
        ui.showSheetsError(r.message || "Could not connect.");
        ui.renderSheetsPage();
      }
    });
  }

  function saveConfigAndConnect(e) {
    e.preventDefault();
    var cfg = readConfigFromForm();
    if (!cfg.webAppUrl) {
      ui.showSheetsError("Please paste your Web App URL.");
      return;
    }
    if (!ET.sheets.validateUrl(cfg.webAppUrl)) {
      ui.showSheetsError("Invalid Web App URL.");
      return;
    }
    ui.hideSheetsError();
    ET.sheets.saveConfig(cfg);
    ui.setSheetsStatus("testing");
    ET.sheets.testConnection(cfg).then(function (r) {
      if (r.success) {
        cfg.lastTestOk = true;
        cfg.lastError = null;
        ET.sheets.saveConfig(cfg);
        ui.toast("Google Sheets connected successfully.", "success");
      } else {
        cfg.lastError = r.message;
        cfg.lastTestOk = false;
        ET.sheets.saveConfig(cfg);
        ui.toast("Connection failed — check the Web App URL and try again.", "error");
      }
      ui.renderSheetsPage();
      refresh();
    });
  }

  function disconnect() {
    state.pendingAction = function () {
      ET.sheets.clearConfig();
      ui.renderSheetsPage();
      refresh();
      ui.toast("Google Sheets disconnected. Your local data is safe.", "info");
    };
    ui.openConfirm(
      "Disconnect Google Sheets?\n\nYour transactions and spreadsheet will NOT be deleted.",
      "Disconnect Google Sheets?",
      "Disconnect"
    );
  }

  function syncAll() {
    if (!ET.sheets.hasValidUrl()) {
      ui.toast("Connect Google Sheets first.", "info");
      return;
    }
    ui.hideSheetsError();
    ui.setSheetsStatus("syncing");
    ui.showSheetsResult("Synchronizing\u2026", false);
    ET.sheets.syncAll().then(function (summary) {
      refresh();
      ui.renderSheetsPage();
      var msg = "Synchronization Complete\n" + summary.synced + " synced, " + summary.failed + " failed" +
        (summary.skipped ? ", " + summary.skipped + " skipped." : ".");
      ui.showSheetsResult(msg, summary.failed > 0);
      ui.toast(msg.replace(/\n/g, " "), summary.failed > 0 ? "error" : "success");
    });
  }

  function confirmSyncExisting() {
    if (!ET.sheets.hasValidUrl()) {
      ui.toast("Connect Google Sheets first.", "info");
      return;
    }
    var all = expenses.all();
    var count = all.filter(function (r) {
      return r.syncStatus !== "synced";
    }).length;
    if (count === 0) {
      ui.toast("All transactions are already synced.", "info");
      return;
    }
    state.pendingAction = function () {
      ui.setSheetsStatus("syncing");
      ui.showSheetsResult("Synchronizing " + count + " transaction(s)\u2026", false);
      ET.sheets.syncExisting().then(function (summary) {
        refresh();
        ui.renderSheetsPage();
        var msg = "Synchronization Complete\n" + summary.synced + " synced, " + summary.failed + " failed" +
          (summary.skipped ? ", " + summary.skipped + " skipped." : ".");
        ui.showSheetsResult(msg, summary.failed > 0);
        ui.toast(msg.replace(/\n/g, " "), summary.failed > 0 ? "error" : "success");
      });
    };
    ui.openConfirm(
      "You have " + count + " local transaction(s) not yet synced.\n\nWould you like to sync them to Google Sheets?",
      "Sync existing transactions?",
      "Sync"
    );
  }

  function copyScript() {
    var code = ET.sheets.APP_SCRIPT_CODE;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(code).then(function () {
        ui.toast("Apps Script code copied to clipboard.", "success");
      }, function () {
        fallbackCopy(code);
      });
    } else {
      fallbackCopy(code);
    }
  }

  function fallbackCopy(text) {
    var ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
      ui.toast("Apps Script code copied to clipboard.", "success");
    } catch (e) {
      ui.toast("Could not copy — select the code manually.", "error");
    }
    document.body.removeChild(ta);
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

    el("btn-confirm-delete").addEventListener("click", confirmCurrentAction);
    el("btn-cancel-delete").addEventListener("click", function () {
      state.pendingDeleteId = null;
      state.pendingAction = null;
      ui.closeConfirm();
    });
    el("confirm-overlay").addEventListener("click", function (e) {
      if (e.target === el("confirm-overlay")) {
        state.pendingDeleteId = null;
        state.pendingAction = null;
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

    // Reports filters
    document.querySelectorAll("[data-range]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        state.reportFilters.range = btn.getAttribute("data-range") || "this-month";
        if (state.reportFilters.range === "custom") {
          var now = new Date();
          var start = new Date(now.getFullYear(), now.getMonth(), 1);
          el("report-start").value = todayKeyOf(start);
          el("report-end").value = todayKeyOf(now);
          state.reportFilters.start = el("report-start").value;
          state.reportFilters.end = el("report-end").value;
        }
        ui.setReportRangeChips(state.reportFilters.range);
        renderReports();
      });
    });
    document.querySelectorAll("[data-rtype]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        state.reportFilters.type = btn.getAttribute("data-rtype") || "all";
        ui.setReportTypeChips(state.reportFilters.type);
        renderReports();
      });
    });
    el("report-category").addEventListener("change", function (e) {
      state.reportFilters.category = e.target.value;
      renderReports();
    });
    el("report-start").addEventListener("change", function (e) {
      state.reportFilters.start = e.target.value;
      state.reportFilters.range = "custom";
      ui.setReportRangeChips("custom");
      renderReports();
    });
    el("report-end").addEventListener("change", function (e) {
      state.reportFilters.end = e.target.value;
      state.reportFilters.range = "custom";
      ui.setReportRangeChips("custom");
      renderReports();
    });

    // Google Sheets page
    el("btn-test-connection").addEventListener("click", testConnection);
    el("sheets-config-form").addEventListener("submit", saveConfigAndConnect);
    el("btn-disconnect").addEventListener("click", disconnect);
    el("btn-sync-all").addEventListener("click", syncAll);
    el("btn-sync-existing").addEventListener("click", confirmSyncExisting);
    el("btn-copy-script").addEventListener("click", copyScript);

    el("btn-menu").addEventListener("click", openSidebar);
    el("sidebar-backdrop").addEventListener("click", closeSidebar);

    document.addEventListener("keydown", function (e) {
      if (e.key !== "Escape") return;
      if (ui.isConfirmOpen()) { state.pendingDeleteId = null; state.pendingAction = null; ui.closeConfirm(); }
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
