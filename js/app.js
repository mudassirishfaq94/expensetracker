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

  function globalLocalSave(key, value) {
    try { global.localStorage.setItem(key, String(value || "")); } catch (e) { /* ignore */ }
  }

  function pad2(n) { return String(n).padStart(2, "0"); }
  function todayKeyOf(d) {
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }

  var state = {
    view: "dashboard",
    navKey: "dashboard",
    filters: { search: "", category: "", month: "", type: "all" },
    reportFilters: { range: "this-month", type: "all", category: "", start: "", end: "" },
    pendingDeleteId: null,
    cloudRetry: null
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
    } else if (state.view === "budgets") {
      ui.renderBudgetsPage(all);
    } else if (state.view === "recurring") {
      ui.renderRecurringPage();
    } else if (state.view === "data") {
      ui.renderDataPage(all);
    } else if (state.view === "settings") {
      ui.renderSettingsPage();
    } else {
      ui.renderDashboard(all);
    }
    ui.renderDashboardBudget(all);
    ui.renderDashboardGoals();
    ui.renderDashboardUpcoming();

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
    if (state.view === "budgets") return "budgets";
    if (state.view === "recurring") return "recurring";
    if (state.view === "data") return "data";
    if (state.view === "settings") return "settings";
    if (state.filters.type === "income") return "income";
    if (state.filters.type === "expense") return "expenses";
    return "transactions";
  }

  function goToView(view) {
    if (view === "settings") {
      state.view = "settings";
      state.navKey = "settings";
      ui.setView("settings", "settings");
      closeSidebar();
      refresh();
      return;
    }
    if (view === "data") {
      state.view = "data";
      state.navKey = "data";
      ui.setView("data", "data");
      closeSidebar();
      refresh();
      return;
    }
    if (view === "recurring") {
      state.view = "recurring";
      state.navKey = "recurring";
      ui.setView("recurring", "recurring");
      closeSidebar();
      processRecurringNow();
      refresh();
      return;
    }
    if (view === "budgets") {
      state.view = "budgets";
      state.navKey = "budgets";
      ui.setView("budgets", "budgets");
      closeSidebar();
      refresh();
      return;
    }
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
    processRecurringNow();
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
      : state.view === "budgets" ? "budgets"
      : state.view === "recurring" ? "recurring"
      : state.view === "data" ? "data"
      : state.view === "settings" ? "settings"
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

  /* ------------------- Budgets & Goals handlers ------------------- */
  function saveMonthlyBudget() {
    var input = el("budget-monthly-input");
    var errBox = el("budget-monthly-error");
    errBox.hidden = true;
    errBox.textContent = "";
    var err = ET.budgets.validateMonthlyBudget(input.value);
    if (err) {
      errBox.textContent = err;
      errBox.hidden = false;
      input.focus();
      return;
    }
    ET.budgets.setMonthlyBudget(input.value);
    refresh();
    ui.toast("Monthly budget saved.");
  }

  function addCategoryBudget() {
    var sel = el("budget-cat-select");
    var amount = el("budget-cat-amount");
    var errBox = el("budget-cat-error");
    errBox.hidden = true;
    errBox.textContent = "";
    var err = ET.budgets.validateCategoryBudget(sel.value, amount.value);
    if (err) {
      errBox.textContent = err;
      errBox.hidden = false;
      return;
    }
    ET.budgets.setCategoryBudget(sel.value, Number(amount.value));
    amount.value = "";
    refresh();
    ui.toast("Category budget saved.");
  }

  function handleBudgetListClick(e) {
    var removeBtn = e.target.closest("[data-remove-cat]");
    if (!removeBtn) return;
    ET.budgets.removeCategoryBudget(removeBtn.getAttribute("data-remove-cat"));
    refresh();
    ui.toast("Category budget removed.", "info");
  }

  function addGoal() {
    var name = el("goal-name");
    var target = el("goal-target");
    var deadline = el("goal-deadline");
    var errBox = el("goal-error");
    errBox.hidden = true;
    errBox.textContent = "";
    var result = ET.budgets.addGoal({ name: name.value, target: target.value, deadline: deadline.value });
    if (result.error) {
      errBox.textContent = result.error;
      errBox.hidden = false;
      return;
    }
    name.value = "";
    target.value = "";
    deadline.value = "";
    refresh();
    ui.toast("Goal created.");
  }

  function handleGoalsListClick(e) {
    var contribBtn = e.target.closest("[data-contribute]");
    if (contribBtn) {
      var gid = contribBtn.getAttribute("data-contribute");
      var amountInput = document.querySelector('[data-contrib-amount="' + gid + '"]');
      var result = ET.budgets.addContribution(gid, { amount: amountInput ? amountInput.value : "" });
      if (result.error) {
        ui.toast(result.error, "error");
      } else {
        if (amountInput) amountInput.value = "";
        refresh();
        ui.toast("Contribution added.");
      }
      return;
    }
    var delBtn = e.target.closest("[data-delete-goal]");
    if (delBtn) {
      var gid2 = delBtn.getAttribute("data-delete-goal");
      state.pendingAction = function () {
        ET.budgets.deleteGoal(gid2);
        refresh();
        ui.toast("Goal deleted.", "info");
      };
      ui.openConfirm("Delete this goal? Its contributions will be removed too.", "Delete goal?", "Delete");
    }
  }

  /* ------------------- Recurring transactions handlers ------------------- */
  var recurringProcessing = false;

  function processRecurringNow() {
    if (recurringProcessing) return;
    recurringProcessing = true;
    var summary;
    try {
      summary = ET.recurring.processRecurringTransactions(expenses.all());
    } catch (err) {
      recurringProcessing = false;
      ui.toast("Could not process recurring transactions.", "error");
      return;
    }
    recurringProcessing = false;

    if (summary.generatedRecords && summary.generatedRecords.length) {
      summary.generatedRecords.forEach(function (rec) { attemptSync(rec); });
    }
    if (summary.generated > 0) {
      ui.toast(summary.generated + " recurring transaction(s) generated.", "success");
    }
    summary.warnings.forEach(function (w) { ui.toast(w, "error"); });
    return summary;
  }

  function readRecurringForm() {
    return {
      type: document.querySelector("[data-rf-type].is-active") ? document.querySelector("[data-rf-type].is-active").getAttribute("data-rf-type") : "expense",
      title: el("rf-title").value,
      amount: el("rf-amount").value,
      category: el("rf-category").value,
      vendor: el("rf-vendor").value,
      notes: el("rf-notes").value,
      frequency: el("rf-frequency").value,
      startDate: el("rf-start-date").value,
      nextDueDate: el("rf-next-due").value,
      isSubscription: el("rf-subscription").checked,
      status: el("rf-status").value
    };
  }

  function handleRecurringSubmit(e) {
    e.preventDefault();
    var id = el("rf-id").value;
    var errBox = el("rf-error");
    errBox.hidden = true;
    errBox.textContent = "";
    var result = id
      ? ET.recurring.updateRecurring(id, readRecurringForm())
      : ET.recurring.addRecurring(readRecurringForm());
    if (result.error) {
      errBox.textContent = result.error;
      errBox.hidden = false;
      return;
    }
    ui.closeRecurringDrawer();
    refresh();
    ui.toast(id ? "Recurring transaction updated." : "Recurring transaction added.");
  }

  function handleRecurringListClick(e) {
    var editBtn = e.target.closest("[data-edit-recurring]");
    if (editBtn) {
      var def = ET.recurring.findById(editBtn.getAttribute("data-edit-recurring"));
      if (def) ui.openRecurringDrawer("edit", def);
      return;
    }
    var toggleBtn = e.target.closest("[data-toggle-recurring]");
    if (toggleBtn) {
      var tid = toggleBtn.getAttribute("data-toggle-recurring");
      var tdef = ET.recurring.findById(tid);
      if (tdef) {
        if (tdef.status === "paused") {
          ET.recurring.resumeRecurring(tid);
          ui.toast("Recurring transaction resumed.");
        } else {
          ET.recurring.pauseRecurring(tid);
          ui.toast("Recurring transaction paused.", "info");
        }
        refresh();
      }
      return;
    }
    var delBtn = e.target.closest("[data-delete-recurring]");
    if (delBtn) {
      var did = delBtn.getAttribute("data-delete-recurring");
      state.pendingAction = function () {
        ET.recurring.deleteRecurring(did);
        refresh();
        ui.toast("Recurring transaction deleted. Historical transactions remain.", "info");
      };
      ui.openConfirm(
        "Delete this recurring transaction?\n\nThis stops future automatic transactions. Historical transactions already generated will remain.",
        "Delete recurring transaction?",
        "Delete"
      );
    }
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

  /* ------------------- Data & Backup handlers ------------------- */
  var importState = null;

  function buildFilename(prefix, ext) {
    var d = new Date();
    var pad = function (n) { return String(n).padStart(2, "0"); };
    var stamp = d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
    return prefix + "-" + stamp + "." + ext;
  }

  function downloadFile(filename, content, mimeType) {
    var blob = new Blob([content], { type: mimeType });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function readFile(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result)); };
      reader.onerror = function () { reject(new Error("Could not read the selected file.")); };
      reader.readAsText(file);
    });
  }

  function readExportFilters() {
    return {
      type: el("export-type").value,
      category: el("export-category").value,
      range: el("export-range").value,
      start: el("export-start").value,
      end: el("export-end").value
    };
  }

  function doExportCsv() {
    var list = ET.data.filterForExport(expenses.all(), readExportFilters());
    if (!list.length) { ui.toast("No transactions match the current filters.", "info"); return; }
    downloadFile(buildFilename("ledger-transactions", "csv"), ET.data.exportTransactionsCSV(list), "text/csv;charset=utf-8");
    ui.toast("Exported " + list.length + " transaction(s) as CSV.");
  }

  function doExportJson() {
    var list = ET.data.filterForExport(expenses.all(), readExportFilters());
    if (!list.length) { ui.toast("No transactions match the current filters.", "info"); return; }
    downloadFile(buildFilename("ledger-transactions", "json"), ET.data.exportTransactionsJSON(list), "application/json");
    ui.toast("Exported " + list.length + " transaction(s) as JSON.");
  }

  function doExportSummary() {
    var list = ET.data.filterForExport(expenses.all(), readExportFilters());
    downloadFile(buildFilename("ledger-financial-summary", "csv"), ET.data.exportFinancialSummaryCSV(list), "text/csv;charset=utf-8");
    ui.toast("Financial summary exported.");
  }

  function showImportError(message) {
    var err = el("import-error");
    if (!err) return;
    err.textContent = message;
    err.hidden = false;
    el("import-preview").hidden = true;
    el("import-mapping").hidden = true;
    var btn = el("btn-do-import");
    if (btn) btn.hidden = true;
  }

  function handleImportFile(text, filename) {
    importState = null;
    var err = el("import-error");
    if (err) { err.hidden = true; err.textContent = ""; }
    var lower = filename.toLowerCase();
    try {
      if (lower.indexOf(".csv") !== -1) {
        var rows = ET.data.parseCSV(text);
        if (rows.length < 2) { showImportError("The CSV file does not contain enough data."); return; }
        var header = rows[0];
        var body = rows.slice(1);
        var indices = ET.data.detectColumnIndices(header);
        if (indices.date < 0 || indices.amount < 0) {
          showImportError("Could not detect required columns (Date and Amount). Use the mapping below to assign them.");
          indices = { date: 0, title: 1, amount: 2, type: -1, category: 3, vendor: -1, notes: -1 };
        }
        importState = { type: "csv", rows: body, header: header, indices: indices };
        ui.renderImportMapping(header, indices);
        el("import-file-name").textContent = filename;
        previewImportNow();
      } else {
        var parsed = JSON.parse(text);
        if (!Array.isArray(parsed)) { showImportError("The JSON file must contain an array of transactions."); return; }
        var candidates = ET.data.buildImportedRowsFromObjects(parsed, "expense");
        importState = { type: "json", candidates: candidates.candidates };
        el("import-file-name").textContent = filename;
        previewImportNow();
      }
    } catch (e) {
      showImportError("Unable to import this file. Reason: " + (e && e.message ? e.message : "unexpected error") + ".");
    }
  }

  function previewImportNow() {
    if (!importState) return;
    var candidates;
    if (importState.type === "csv") {
      var mapping = ui.readImportMapping();
      var built = ET.data.buildImportedRows(importState.rows, mapping, el("import-default-type").value);
      candidates = built.candidates;
    } else {
      candidates = importState.candidates;
    }
    var preview = ET.data.previewImport(candidates, expenses.all());
    ui.renderImportPreview(preview, candidates, el("import-file-name").textContent);
  }

  function doImport() {
    if (!importState) return;
    var candidates;
    if (importState.type === "csv") {
      var mapping = ui.readImportMapping();
      candidates = ET.data.buildImportedRows(importState.rows, mapping, el("import-default-type").value).candidates;
    } else {
      candidates = importState.candidates;
    }
    var preview = ET.data.previewImport(candidates, expenses.all());
    if (!preview.valid.length) { ui.toast("No valid transactions to import.", "info"); return; }
    var result = ET.data.importValidRows(preview);
    refresh();
    ui.toast("Import complete: " + result.imported + " imported, " + result.skippedDuplicates + " duplicates skipped, " + result.skippedInvalid + " invalid skipped.");
    /* Offer to sync to Google Sheets through the existing queue. */
    if (ET.sheets.isConnected() && result.imported > 0) {
      ui.toast("New transactions are pending sync. Use Sync All on the Google Sheets page.", "info");
    }
  }

  function doCreateBackup() {
    var backup = ET.data.createFullBackup();
    downloadFile(buildFilename("ledger-backup", "json"), JSON.stringify(backup, null, 2), "application/json");
    ui.renderDataPage(expenses.all());
    ui.toast("Full backup downloaded.");
  }

  function handleBackupFile(file) {
    readFile(file).then(function (text) {
      var obj;
      try { obj = JSON.parse(text); }
      catch (e) { ui.toast("Unable to import this file: it is not valid JSON.", "error"); return; }
      var v = ET.data.validateBackup(obj);
      if (!v.valid) { ui.toast("Unable to import this file. Reason: " + v.reason, "error"); return; }
      state.backupObject = obj;
      var info = ET.data.previewBackup(obj);
      ui.renderBackupPreview(info);
      var mode = el("restore-mode");
      if (mode) mode.hidden = false;
      el("restore-confirm-input").value = "";
      el("btn-restore").disabled = true;
      ui.toast("Backup file loaded. Review the preview and choose restore mode.");
    }).catch(function (e) {
      ui.toast("Could not read the backup file: " + (e && e.message ? e.message : "unknown error"), "error");
    });
  }

  function setRestoreMode() {
    var replace = document.querySelector('input[name="restore-mode"]:checked');
    var isReplace = replace && replace.value === "replace";
    el("restore-confirm-field").hidden = !isReplace;
    updateRestoreButton();
  }

  function updateRestoreButton() {
    var replace = document.querySelector('input[name="restore-mode"]:checked');
    var isReplace = replace && replace.value === "replace";
    var ok = !isReplace || el("restore-confirm-input").value.trim() === "RESTORE";
    el("btn-restore").disabled = !ok || !state.backupObject;
  }

  function doRestore() {
    if (!state.backupObject) return;
    var replace = document.querySelector('input[name="restore-mode"]:checked');
    var isReplace = replace && replace.value === "replace";
    var backup = state.backupObject;
    state.pendingAction = function () {
      var result;
      if (isReplace) {
        result = ET.data.restoreBackup(backup);
        ui.toast("Backup restored (" + result.transactions + " transactions).");
      } else {
        result = ET.data.mergeBackup(backup, expenses.all());
        ui.toast("Merge complete: " + result.imported + " new transactions, " + result.skippedDuplicates + " duplicates skipped.");
      }
      state.backupObject = null;
      el("backup-preview").hidden = true;
      el("restore-mode").hidden = true;
      refresh();
    };
    ui.openConfirm(
      isReplace
        ? "Replace all current application data with the backup?\n\nThis cannot be undone. Consider downloading a current backup first."
        : "Merge the backup into current data?\n\nNew records will be added and existing IDs will be skipped.",
      isReplace ? "Replace existing data?" : "Merge backup?",
      isReplace ? "Replace" : "Merge"
    );
  }

  function setupDangerButton(inputId, btnId, phrase, action) {
    var input = el(inputId);
    var btn = el(btnId);
    if (!input || !btn) return;
    input.addEventListener("input", function () {
      btn.disabled = input.value.trim() !== phrase;
    });
    btn.addEventListener("click", function () {
      if (input.value.trim() !== phrase) return;
      state.pendingAction = action;
      ui.openConfirm("This will " + phrase.toLowerCase().replace(/_/g, " ") + ".\n\nConsider downloading a full backup first.", "Are you sure?", "Continue");
    });
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
        var range = btn.getAttribute("data-range") || "this-month";
        state.reportFilters.range = range;
        if (range === "custom") {
          var now = new Date();
          var start = new Date(now.getFullYear(), now.getMonth(), 1);
          el("report-start").value = todayKeyOf(start);
          el("report-end").value = todayKeyOf(now);
          state.reportFilters.start = el("report-start").value;
          state.reportFilters.end = el("report-end").value;
        } else {
          /* Drop stale custom dates so they can never leak into the next
             range (especially "all" / "this-month"). */
          state.reportFilters.start = "";
          state.reportFilters.end = "";
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

    // Budgets & Goals
    el("btn-save-monthly-budget").addEventListener("click", saveMonthlyBudget);
    el("btn-add-cat-budget").addEventListener("click", addCategoryBudget);
    el("category-budget-list").addEventListener("click", handleBudgetListClick);
    el("btn-add-goal").addEventListener("click", addGoal);
    el("goals-list").addEventListener("click", handleGoalsListClick);

    // Recurring & subscriptions
    el("btn-add-recurring").addEventListener("click", function () { ui.openRecurringDrawer("add", null); });
    el("btn-check-due").addEventListener("click", function () {
      var summary = processRecurringNow();
      refresh();
      if (summary) {
        ui.toast("Checked due transactions: " + summary.generated + " generated.", summary.generated ? "success" : "info");
      }
    });
    el("recurring-form").addEventListener("submit", handleRecurringSubmit);
    el("btn-close-recurring-drawer").addEventListener("click", ui.closeRecurringDrawer);
    el("btn-cancel-recurring-drawer").addEventListener("click", ui.closeRecurringDrawer);
    el("recurring-drawer-overlay").addEventListener("click", ui.closeRecurringDrawer);
    el("recurring-list").addEventListener("click", handleRecurringListClick);
    el("subscriptions-list").addEventListener("click", handleRecurringListClick);
    document.querySelectorAll("[data-action='open-recurring-add']").forEach(function (b) {
      b.addEventListener("click", function () { ui.openRecurringDrawer("add", null); });
    });
    document.querySelectorAll("[data-rf-type]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        ui.setRecurringFormType(btn.getAttribute("data-rf-type"));
      });
    });
    document.querySelectorAll("[data-rtab]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        ui.setRecurringTab(btn.getAttribute("data-rtab"));
      });
    });

    // Data & Backup
    // Export filter changes
    ["export-type","export-category","export-range"].forEach(function (id) {
      el(id).addEventListener("change", function () { ui.updateExportCount(expenses.all()); });
    });
    el("export-start").addEventListener("change", function () { ui.updateExportCount(expenses.all()); });
    el("export-end").addEventListener("change", function () { ui.updateExportCount(expenses.all()); });
    el("export-range").addEventListener("change", function () {
      el("export-custom-range").hidden = el("export-range").value !== "custom";
    });

    el("btn-export-csv").addEventListener("click", doExportCsv);
    el("btn-export-json").addEventListener("click", doExportJson);
    el("btn-export-summary").addEventListener("click", doExportSummary);

    // Import
    el("import-file").addEventListener("change", function (e) {
      var file = e.target.files[0];
      if (!file) return;
      handleImportFile(file, file.name);
    });
    el("import-mapping").addEventListener("change", function () {
      previewImportNow();
    });
    el("btn-do-import").addEventListener("click", doImport);

    // Backup
    el("btn-create-backup").addEventListener("click", doCreateBackup);
    el("backup-file").addEventListener("change", function (e) {
      var file = e.target.files[0];
      if (!file) return;
      handleBackupFile(file);
    });
    document.querySelectorAll('input[name="restore-mode"]').forEach(function (r) {
      r.addEventListener("change", setRestoreMode);
    });
    el("restore-confirm-input").addEventListener("input", updateRestoreButton);
    el("btn-restore").addEventListener("click", doRestore);

    // Danger zone
    setupDangerButton("confirm-clear-tx", "btn-clear-tx", "CLEAR TRANSACTIONS", function () {
      ET.data.clearTransactions();
      refresh();
      ui.toast("All transactions cleared.");
    });
    setupDangerButton("confirm-clear-test", "btn-clear-test", "CLEAR TEST DATA", function () {
      ET.data.clearTestData();
      refresh();
      ui.toast("Test data cleared.");
    });
    setupDangerButton("confirm-reset", "btn-reset", "RESET EVERYTHING", function () {
      ET.data.resetApplication();
      refresh();
      ui.toast("Application has been reset.");
    });

    // Auth screen
    el("btn-login").addEventListener("click", function () { handleAuthSubmit("login-form"); });
    el("login-form").addEventListener("submit", function (e) { e.preventDefault(); handleAuthSubmit("login-form"); });
    el("btn-signup").addEventListener("click", function () { handleAuthSubmit("signup-form"); });
    el("signup-form").addEventListener("submit", function (e) { e.preventDefault(); handleAuthSubmit("signup-form"); });
    el("btn-forgot").addEventListener("click", function () { handleAuthSubmit("forgot-form"); });
    el("forgot-form").addEventListener("submit", function (e) { e.preventDefault(); handleAuthSubmit("forgot-form"); });
    document.querySelectorAll("[data-auth-view]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        ui.showAuthView(btn.getAttribute("data-auth-view"));
      });
    });

    // Migration
    el("btn-migrate").addEventListener("click", doMigrate);
    el("btn-skip-migration").addEventListener("click", skipMigration);

    // Cloud error retry / logout
    el("btn-cloud-retry").addEventListener("click", function () {
      ui.hideCloudError();
      if (state.cloudRetry) state.cloudRetry();
    });
    el("btn-cloud-logout").addEventListener("click", handleLogout);

    // Logout (sidebar user area + settings)
    el("btn-logout").addEventListener("click", handleLogout);
    el("btn-settings-logout").addEventListener("click", handleLogout);

    // Settings
    el("btn-save-settings").addEventListener("click", function () {
      var currency = el("settings-currency").value;
      globalLocalSave("et_currency_pref", currency);
      if (ET.database.isCloudMode()) {
        ET.database.updateUserSettings({ currency: currency }).then(function () {
          ui.toast("Preferences saved.");
        });
      } else {
        ui.toast("Preferences saved.");
      }
    });

    el("btn-menu").addEventListener("click", openSidebar);
    el("sidebar-backdrop").addEventListener("click", closeSidebar);

    document.addEventListener("keydown", function (e) {
      if (e.key !== "Escape") return;
      if (ui.isConfirmOpen()) { state.pendingDeleteId = null; state.pendingAction = null; ui.closeConfirm(); }
      else if (ui.isRecurringDrawerOpen()) { ui.closeRecurringDrawer(); }
      else if (ui.isDrawerOpen()) { ui.closeDrawer(); }
      else if (el("sidebar").classList.contains("is-open")) { closeSidebar(); }
    });
  }

  /* ------------------- Cloud (Supabase) startup flow ------------------- */

  function startLocalApp() {
    ET.database.setCloudMode(false);
    ui.hideAuthScreen();
    ui.hideLoading();
    ui.hideUserMenu();
    ui.setView("dashboard", "dashboard");
    processRecurringNow();
    refresh({ animateDashboard: true });
  }

  function enterCloudApp(user) {
    ui.showLoading("Loading your financial data\u2026");
    ET.database.setCloudMode(true);
    ET.database.subscribeToMutations();
    ET.database.ensureProfile()
      .then(function () {
        var check = ET.migration.runCheck();
        if (check === true) {
          ui.hideLoading();
          ui.updateUserMenu(user);
          ui.showMigrationScreen();
          return;
        }
        return ET.database.loadAll().then(function () {
          ui.hideLoading();
          ui.updateUserMenu(user);
          ui.hideMigrationScreen();
          ui.setView("dashboard", "dashboard");
          processRecurringNow();
          refresh({ animateDashboard: true });
        });
      })
      .catch(function (err) {
        console.error("[Ledger] cloud startup error:", err);
        ui.hideLoading();
        state.cloudRetry = function () { enterCloudApp(user); };
        ui.showCloudError("Unable to load your financial data. Please check your internet connection and try again.");
      });
  }

  function doMigrate() {
    var btn = el("btn-migrate");
    btn.disabled = true;
    btn.textContent = "Migrating\u2026";
    var errBox = el("migration-error");
    errBox.hidden = true;
    errBox.textContent = "";
    ET.migration.migrate().then(function (result) {
      btn.disabled = false;
      btn.textContent = "Migrate My Data";
      if (result.ok) {
        return ET.database.loadAll().then(function () {
          ui.hideMigrationScreen();
          ui.updateUserMenu(ET.auth.getUser());
          ui.setView("dashboard", "dashboard");
          processRecurringNow();
          refresh({ animateDashboard: true });
          ui.toast("Your data has been successfully migrated to cloud storage. Your local backup remains available temporarily.");
        });
      }
      errBox.textContent = result.error || "Migration could not be completed. Your existing local data is still safe on this device.";
      errBox.hidden = false;
    });
  }

  function skipMigration() {
    ET.migration.saveMeta({ status: "skipped", skippedAt: Date.now() });
    ET.database.loadAll().then(function () {
      ui.hideMigrationScreen();
      ui.updateUserMenu(ET.auth.getUser());
      ui.setView("dashboard", "dashboard");
      processRecurringNow();
      refresh({ animateDashboard: true });
      ui.toast("Skipped for now. You can migrate from Data & Backup later.", "info");
    });
  }

  async function handleLogout() {
    await ET.auth.signOut();
    ET.database.setCloudMode(false);
    ui.hideUserMenu();
    ui.hideMigrationScreen();
    ui.hideCloudError();
    ui.hideLoading();
    ui.showAuthScreen();
  }

  function handleAuthSubmit(formId) {
    var form = el(formId);
    if (formId === "login-form") {
      ui.setAuthBusy("login", true, "Logging in\u2026");
      ET.auth.signIn(el("login-email").value, el("login-password").value).then(function (res) {
        ui.setAuthBusy("login", false);
        if (res.error) {
          showAuthError("login-error", res.error);
          return;
        }
        ui.hideAuthScreen();
        enterCloudApp(res.user);
      });
    } else if (formId === "signup-form") {
      var password = el("signup-password").value;
      var confirm = el("signup-confirm").value;
      if (password !== confirm) {
        showAuthError("signup-error", "Passwords do not match.");
        return;
      }
      ui.setAuthBusy("signup", true, "Creating account\u2026");
      ET.auth.signUp({
        email: el("signup-email").value,
        password: password,
        fullName: el("signup-name").value
      }).then(function (res) {
        ui.setAuthBusy("signup", false);
        if (res.error) {
          showAuthError("signup-error", res.error);
          return;
        }
        if (res.requiresEmailConfirmation) {
          showAuthSuccess("signup-error", "Account created successfully. Please check your email to confirm your account.");
          return;
        }
        ui.hideAuthScreen();
        enterCloudApp(res.user);
      });
    } else if (formId === "forgot-form") {
      ui.setAuthBusy("forgot", true, "Sending link\u2026");
      ET.auth.resetPassword(el("forgot-email").value).then(function (res) {
        ui.setAuthBusy("forgot", false);
        if (res.error) {
          showAuthError("forgot-error", res.error);
          return;
        }
        showAuthSuccess("forgot-error", "Reset link sent. Check your email.");
      });
    }
  }

  function showAuthError(id, message) {
    var box = el(id);
    box.textContent = message;
    box.classList.remove("is-success");
    box.hidden = false;
  }
  function showAuthSuccess(id, message) {
    var box = el(id);
    box.textContent = message;
    box.classList.add("is-success");
    box.hidden = false;
  }

  /* Handle password recovery redirects (?type=recovery) by showing a reset form. */
  function handlePasswordRecovery() {
    try {
      var hash = global.location && global.location.hash ? global.location.hash : "";
      if (hash.indexOf("type=recovery") !== -1 || (global.location && global.location.search && global.location.search.indexOf("type=recovery") !== -1)) {
        var newPw = global.prompt("Enter a new password (at least 8 characters):");
        if (newPw) {
          ET.auth.updatePassword(newPw).then(function (res) {
            if (res.ok) ui.toast("Password updated. You can log in with your new password.", "success");
            else ui.toast(res.error || "Could not update password.", "error");
          });
        }
        return true;
      }
    } catch (e) { /* ignore */ }
    return false;
  }

  function init() {
    ui.populateCategorySelects();
    wire();

    ET.supabase.init();
    if (!ET.supabase.isConfigured()) {
      startLocalApp();
      return;
    }

    ET.database.subscribeToMutations();
    ET.auth.onAuthStateChange(function (event) {
      if (event === "SIGNED_OUT") {
        ET.database.setCloudMode(false);
        ui.hideUserMenu();
        ui.showAuthScreen();
      }
    });

    ui.showLoading();
    ET.auth.restoreSession().then(function (user) {
      if (user) {
        enterCloudApp(user);
      } else {
        if (handlePasswordRecovery()) return;
        ui.showAuthScreen();
      }
    }).catch(function () {
      ui.showAuthScreen();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  ET.app = { refresh: refresh, goToView: goToView, _state: state };
})(window, document);
