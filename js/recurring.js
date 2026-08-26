/* =========================================================================
   recurring.js — recurring transactions & subscription tracking (Part 7)
   Pure domain logic on top of ET.storage and the central transaction
   system (ET.transactions). No DOM.

   - Recurring definitions are stored separately from actual transactions.
   - processRecurringTransactions() generates real transactions through the
     existing addTransaction() path — so dashboard, reports, budgets and
     Google Sheets all pick them up automatically.
   - Generation is idempotent: each recurrence period is generated at most
     once (guarded by recurringId + date AND by advancing nextDueDate).
   - Safe catch-up: up to MAX_CATCH_UP missed periods per item per cycle.

   Attaches to: window.ET.recurring
   ========================================================================= */
(function (global) {
  "use strict";

  var ET = (global.ET = global.ET || {});
  var storage = ET.storage;

  var FREQUENCIES = ["daily", "weekly", "monthly", "yearly"];
  var MAX_CATCH_UP = 12;
  var DAY_MS = 86400000;

  function roundMoney(n) {
    if (!isFinite(n)) return 0;
    return Math.round(n * 100) / 100;
  }

  function pad2(n) { return String(n).padStart(2, "0"); }

  function toYMD(d) {
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }

  function parseDate(s) {
    if (!s || typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
    var p = s.split("-");
    var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    if (isNaN(d.getTime())) return null;
    if (d.getFullYear() !== Number(p[0]) || d.getMonth() !== Number(p[1]) - 1 || d.getDate() !== Number(p[2])) return null;
    return d;
  }

  function todayStart() {
    var d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }

  function daysInMonth(year, month) {
    return new Date(year, month + 1, 0).getDate();
  }

  function uid() {
    if (global.crypto && global.crypto.randomUUID) return "recurring_" + global.crypto.randomUUID();
    return "recurring_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function isValidDateString(s) {
    return parseDate(s) !== null;
  }

  /* --------------------------- definitions ------------------------------ */

  function defaultCurrency() {
    return ET.settings ? ET.settings.getCurrency() : "AED";
  }

  function normalizeDef(def) {
    return {
      id: String(def.id || ""),
      type: storage.normalizeType(def.type),
      title: String(def.title || ""),
      amount: Number(def.amount) || 0,
      currency: String(def.currency || defaultCurrency()),
      category: String(def.category || ""),
      vendor: String(def.vendor || ""),
      notes: String(def.notes || ""),
      frequency: FREQUENCIES.indexOf(def.frequency) !== -1 ? def.frequency : "monthly",
      startDate: def.startDate || "",
      nextDueDate: def.nextDueDate || "",
      lastGeneratedDate: def.lastGeneratedDate || "",
      isSubscription: !!def.isSubscription,
      status: def.status === "paused" ? "paused" : "active",
      needsReview: !!def.needsReview,
      createdAt: def.createdAt,
      updatedAt: def.updatedAt
    };
  }

  function getRecurring() {
    var list = storage.getRecurring();
    if (!Array.isArray(list)) return [];
    return list.map(normalizeDef);
  }

  function saveRecurring(list) {
    storage.saveRecurring(Array.isArray(list) ? list : []);
  }

  function findById(id) {
    return getRecurring().filter(function (d) { return d.id === id; })[0] || null;
  }

  /* ----------------------------- validation ----------------------------- */

  function validate(input) {
    if (!input.title || !String(input.title).trim()) return "Give the recurring transaction a title.";
    if (String(input.title).trim().length > 80) return "Title is too long (max 80 characters).";
    var amount = Number(input.amount);
    if (input.amount === "" || input.amount == null || isNaN(amount)) return "Enter a valid amount.";
    if (amount <= 0) return "Amount must be greater than zero.";
    if (FREQUENCIES.indexOf(input.frequency) === -1) return "Choose a frequency (daily, weekly, monthly or yearly).";
    if (!isValidDateString(input.startDate || "")) return "Enter a valid start date.";
    if (input.nextDueDate && !isValidDateString(input.nextDueDate)) return "Enter a valid next due date.";
    return null;
  }

  /* --------------------------- due date math ---------------------------- */

  function advanceDaily(from) { var d = new Date(from); d.setDate(d.getDate() + 1); return d; }
  function advanceWeekly(from) { var d = new Date(from); d.setDate(d.getDate() + 7); return d; }

  function advanceMonthly(from, anchorDay) {
    var ty = from.getFullYear();
    var tm = from.getMonth() + 1;
    if (tm > 11) { tm = 0; ty++; }
    var day = anchorDay != null ? Math.min(anchorDay, daysInMonth(ty, tm)) : from.getDate();
    var d = new Date(ty, tm, day);
    if (d <= from) {
      tm++; if (tm > 11) { tm = 0; ty++; }
      day = anchorDay != null ? Math.min(anchorDay, daysInMonth(ty, tm)) : from.getDate();
      d = new Date(ty, tm, day);
    }
    return d;
  }

  function advanceYearly(from, anchorMonth, anchorDay) {
    var ty = from.getFullYear() + 1;
    var m = anchorMonth != null ? anchorMonth : from.getMonth();
    var day = anchorDay != null ? anchorDay : from.getDate();
    day = Math.min(day, daysInMonth(ty, m));
    return new Date(ty, m, day);
  }

  function advance(date, frequency, anchorMonth, anchorDay) {
    if (frequency === "daily") return advanceDaily(date);
    if (frequency === "weekly") return advanceWeekly(date);
    if (frequency === "monthly") return advanceMonthly(date, anchorDay);
    return advanceYearly(date, anchorMonth, anchorDay);
  }

  /**
   * Reliable next-due-date calculation. For monthly/yearly the anchor
   * (month+day from the original start date) is preserved, so 31 Jan ->
   * 28 Feb -> 31 Mar works, and 29 Feb only lands on leap years.
   */
  function calculateNextDueDate(dateStr, frequency, anchorMonth, anchorDay) {
    var from = parseDate(dateStr);
    if (!from) return "";
    var next = advance(from, frequency, anchorMonth, anchorDay);
    return toYMD(next);
  }

  function anchorOf(def) {
    var src = parseDate(def.startDate || def.nextDueDate);
    if (!src) return { month: null, day: null };
    return { month: src.getMonth(), day: src.getDate() };
  }

  /* ------------------------------ CRUD ---------------------------------- */

  function addRecurring(input) {
    var err = validate(input);
    if (err) return { error: err };
    var now = Date.now();
    var startDate = String(input.startDate || "").trim();
    var nextDueDate = (input.nextDueDate && String(input.nextDueDate).trim()) || startDate;
    var def = {
      id: uid(),
      type: storage.normalizeType(input.type),
      title: String(input.title).trim(),
      amount: roundMoney(Number(input.amount)),
      currency: String(input.currency || defaultCurrency()),
      category: String(input.category || ""),
      vendor: String(input.vendor || ""),
      notes: String(input.notes || ""),
      frequency: input.frequency,
      startDate: startDate,
      nextDueDate: nextDueDate,
      lastGeneratedDate: "",
      isSubscription: !!input.isSubscription,
      status: input.status === "paused" ? "paused" : "active",
      needsReview: false,
      createdAt: now,
      updatedAt: now
    };
    var list = getRecurring();
    list.push(def);
    saveRecurring(list);
    return { def: def };
  }

  function updateRecurring(id, input) {
    var list = getRecurring();
    var def = list.filter(function (d) { return d.id === id; })[0];
    if (!def) return { error: "Recurring transaction not found." };
    var next = {
      title: input.title != null ? input.title : def.title,
      amount: input.amount != null ? input.amount : def.amount,
      category: input.category != null ? input.category : def.category,
      vendor: input.vendor != null ? input.vendor : def.vendor,
      notes: input.notes != null ? input.notes : def.notes,
      frequency: input.frequency != null ? input.frequency : def.frequency,
      startDate: input.startDate != null ? input.startDate : def.startDate,
      nextDueDate: input.nextDueDate != null ? input.nextDueDate : def.nextDueDate,
      isSubscription: input.isSubscription != null ? input.isSubscription : def.isSubscription,
      status: input.status != null ? input.status : def.status
    };
    var err = validate(next);
    if (err) return { error: err };
    def.title = String(next.title).trim();
    def.amount = roundMoney(Number(next.amount));
    def.category = String(next.category || "");
    def.vendor = String(next.vendor || "");
    def.notes = String(next.notes || "");
    def.frequency = next.frequency;
    def.startDate = String(next.startDate || "");
    def.nextDueDate = String(next.nextDueDate || def.startDate);
    def.isSubscription = !!next.isSubscription;
    def.status = next.status === "paused" ? "paused" : "active";
    def.updatedAt = Date.now();
    saveRecurring(list);
    return { def: def };
  }

  function deleteRecurring(id) {
    var list = getRecurring();
    var next = list.filter(function (d) { return d.id !== id; });
    if (next.length === list.length) return false;
    saveRecurring(next);
    return true;
  }

  function setStatus(id, status) {
    var list = getRecurring();
    var def = list.filter(function (d) { return d.id === id; })[0];
    if (!def) return { error: "Recurring transaction not found." };
    def.status = status === "paused" ? "paused" : "active";
    def.updatedAt = Date.now();
    saveRecurring(list);
    return { def: def };
  }

  function pauseRecurring(id) { return setStatus(id, "paused"); }
  function resumeRecurring(id) { return setStatus(id, "active"); }

  /* ---------------------------- processing ------------------------------ */

  function periodsBetween(dueDate, today, frequency) {
    var diffDays = Math.floor((today - dueDate) / DAY_MS);
    if (diffDays < 0) return 0;
    if (frequency === "daily") return diffDays + 1;
    if (frequency === "weekly") return Math.floor(diffDays / 7) + 1;
    if (frequency === "yearly") return (today.getFullYear() - dueDate.getFullYear()) + 1;
    /* monthly */
    var months = (today.getFullYear() * 12 + today.getMonth()) - (dueDate.getFullYear() * 12 + dueDate.getMonth());
    return Math.max(1, months + 1);
  }

  /**
   * Generate real transactions for every active, due recurring definition.
   * Idempotent: each period is generated exactly once (guarded by
   * recurringId+date and by advancing nextDueDate). Catch-up is capped at
   * MAX_CATCH_UP periods per item per run.
   */
  async function processRecurringTransactions(transactions) {
    transactions = transactions || (ET.transactions ? ET.transactions.all() : []);
    var defs = getRecurring();
    var today = todayStart();
    var summary = { generated: 0, skipped: 0, generatedRecords: [], warnings: [] };
    var anyChange = false;

    for (var di = 0; di < defs.length; di++) {
      var def = defs[di];
      if (def.status !== "active") continue;
      var due = parseDate(def.nextDueDate);
      if (!due || due > today) continue;

      var count = periodsBetween(due, today, def.frequency);
      var truncated = count > MAX_CATCH_UP;
      if (truncated) count = MAX_CATCH_UP;

      var anchor = anchorOf(def);
      var dueDates = [];
      var cursor = parseDate(def.nextDueDate);
      for (var i = 0; i < count; i++) {
        dueDates.push(toYMD(cursor));
        cursor = advance(cursor, def.frequency, anchor.month, anchor.day);
      }
      var nextDate = toYMD(cursor);

      var generated = 0;
      for (var ddi = 0; ddi < dueDates.length; ddi++) {
        var dueDate = dueDates[ddi];
        var exists = transactions.some(function (t) {
          return t.recurringId === def.id && t.date === dueDate;
        });
        if (exists) { summary.skipped++; continue; }
        var record = await ET.transactions.addTransaction({
          type: def.type,
          title: def.title,
          amount: def.amount,
          currency: def.currency,
          category: def.category,
          vendor: def.vendor,
          date: dueDate,
          notes: def.notes,
          recurringId: def.id
        });
        summary.generated++;
        generated++;
        summary.generatedRecords.push(record);
      }

      if (dueDates.length > 0) {
        def.lastGeneratedDate = dueDates[dueDates.length - 1];
        def.nextDueDate = nextDate;
        def.updatedAt = Date.now();
        anyChange = true;
      }
      if (truncated) {
        def.needsReview = true;
        anyChange = true;
        summary.warnings.push(
          "Reached the catch-up limit (12) for \u201C" + def.title + "\u201D. Some older periods were skipped \u2014 check your history."
        );
      }
    }

    if (anyChange) saveRecurring(defs);
    return summary;
  }

  /* --------------------------- upcoming & summary ----------------------- */

  function upcomingPayments() {
    var defs = getRecurring();
    var today = todayStart();
    var rows = [];
defs.forEach(function (def) {
      if (def.status !== "active") return;
      var due = parseDate(def.nextDueDate);
      if (!due) return;
      rows.push({
        id: def.id,
        type: def.type,
        title: def.title,
        amount: def.amount,
        currency: def.currency || defaultCurrency(),
        category: def.category,
        dueDate: def.nextDueDate,
        daysToDue: Math.round((due - today) / DAY_MS),
        isSubscription: !!def.isSubscription
      });
    });
    rows.sort(function (a, b) { return a.daysToDue - b.daysToDue; });
    return rows;
  }

  function monthlyEquivalent(amount, frequency) {
    var a = Number(amount) || 0;
    if (frequency === "daily") return roundMoney(a * 30);
    if (frequency === "weekly") return roundMoney((a * 52) / 12);
    if (frequency === "yearly") return roundMoney(a / 12);
    return roundMoney(a);
  }

  function subscriptionSummary() {
    var defs = getRecurring().filter(function (d) {
      return d.isSubscription && d.type === "expense";
    });
    var active = defs.filter(function (d) { return d.status === "active"; });
    var today = todayStart();
    var endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);

    var monthlyCost = active.reduce(function (sum, d) {
      return sum + monthlyEquivalent(d.amount, d.frequency);
    }, 0);

    var upcoming = active.filter(function (d) {
      var due = parseDate(d.nextDueDate);
      return due && due >= today && due <= endOfMonth;
    });
    var upcomingCost = upcoming.reduce(function (sum, d) { return sum + (Number(d.amount) || 0); }, 0);

    return {
      totalCount: defs.length,
      activeCount: active.length,
      monthlyCost: roundMoney(monthlyCost),
      upcomingCount: upcoming.length,
      upcomingCost: roundMoney(upcomingCost),
      hasEstimatedMonthly: active.some(function (d) { return d.frequency !== "monthly"; })
    };
  }

  /* ------------------------------ public API ---------------------------- */

  ET.recurring = {
    FREQUENCIES: FREQUENCIES,
    MAX_CATCH_UP: MAX_CATCH_UP,
    getRecurring: getRecurring,
    saveRecurring: saveRecurring,
    findById: findById,
    addRecurring: addRecurring,
    updateRecurring: updateRecurring,
    deleteRecurring: deleteRecurring,
    pauseRecurring: pauseRecurring,
    resumeRecurring: resumeRecurring,
    validate: validate,
    calculateNextDueDate: calculateNextDueDate,
    processRecurringTransactions: processRecurringTransactions,
    upcomingPayments: upcomingPayments,
    subscriptionSummary: subscriptionSummary,
    monthlyEquivalent: monthlyEquivalent
  };
})(window);

