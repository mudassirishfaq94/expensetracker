/* =========================================================================
   budgets.js — monthly budgets, category budgets and savings goals (Part 6)
   Pure domain logic on top of ET.storage. No DOM, no Chart.js.

   - Monthly budget: set a total spending limit; tracked against the current
     month's EXPENSE transactions (income and goal contributions never count).
   - Category budgets: per-category monthly limits.
   - Goals: savings targets with contributions. Contributions are separate
     from transactions — they never count as expenses or income.

   All inputs are validated; errors come back as clear message strings.

   Attaches to: window.ET.budgets
   ========================================================================= */
(function (global) {
  "use strict";

  var ET = (global.ET = global.ET || {});
  var storage = ET.storage;

  var WARNING_LEVEL = 80;

  function roundMoney(n) {
    if (!isFinite(n)) return 0;
    return Math.round(n * 100) / 100;
  }

  function pad2(n) { return String(n).padStart(2, "0"); }
  function currentMonthKey() {
    var d = new Date();
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1);
  }
  function monthKeyOf(dateStr) { return (dateStr || "").slice(0, 7); }
  function todayKey() {
    var d = new Date();
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }

  function uid() {
    if (global.crypto && global.crypto.randomUUID) return global.crypto.randomUUID();
    return "g-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
  }

  /* --------------------------- budgets config --------------------------- */

  function getBudgetsConfig() {
    var cfg = storage.getBudgetsConfig() || {};
    var categories = {};
    if (cfg.categories && typeof cfg.categories === "object") {
      Object.keys(cfg.categories).forEach(function (cat) {
        categories[cat] = Number(cfg.categories[cat]) || 0;
      });
    }
    return {
      monthly: Number(cfg.monthly) || 0,
      categories: categories
    };
  }

  function saveBudgetsConfig(cfg) {
    storage.saveBudgetsConfig({
      monthly: Number(cfg.monthly) || 0,
      categories: cfg.categories || {}
    });
  }

  function setMonthlyBudget(amount) {
    var cfg = getBudgetsConfig();
    cfg.monthly = roundMoney(Number(amount) || 0);
    saveBudgetsConfig(cfg);
    return cfg;
  }

  function setCategoryBudget(category, amount) {
    var cfg = getBudgetsConfig();
    cfg.categories[category] = roundMoney(Number(amount) || 0);
    saveBudgetsConfig(cfg);
    return cfg;
  }

  function removeCategoryBudget(category) {
    var cfg = getBudgetsConfig();
    delete cfg.categories[category];
    saveBudgetsConfig(cfg);
    return cfg;
  }

  function hasCategoryBudget(category) {
    return Object.prototype.hasOwnProperty.call(getBudgetsConfig().categories, category);
  }

  /* ----------------------------- validation ----------------------------- */

  function validateAmount(value, label) {
    if (value === "" || value == null || isNaN(Number(value))) {
      return "Enter a valid " + label.toLowerCase() + ".";
    }
    if (Number(value) <= 0) {
      return label + " must be greater than zero.";
    }
    return null;
  }

  function validateMonthlyBudget(amount) {
    return validateAmount(amount, "Monthly budget");
  }

  function validateCategoryBudget(category, amount) {
    if (!category) return "Choose a category.";
    var cats = storage.EXPENSE_CATEGORIES || [];
    if (cats.indexOf(category) === -1) return "Pick a valid expense category.";
    if (hasCategoryBudget(category)) {
      return "A budget for \u201C" + category + "\u201D already exists. Edit it below instead.";
    }
    return validateAmount(amount, "Category budget");
  }

  function validateGoal(input) {
    if (!input.name || !String(input.name).trim()) return "Give the goal a name.";
    if (String(input.name).trim().length > 60) return "Goal name is too long (max 60 characters).";
    var target = Number(input.target);
    if (input.target === "" || input.target == null || isNaN(target)) {
      return "Enter a valid target amount.";
    }
    if (target <= 0) return "Target amount must be greater than zero.";
    if (input.deadline && !isValidDateString(input.deadline)) {
      return "Enter a valid deadline date.";
    }
    return null;
  }

  function validateContribution(input) {
    var amt = Number(input.amount);
    if (input.amount === "" || input.amount == null || isNaN(amt)) {
      return "Enter a valid contribution amount.";
    }
    if (amt <= 0) return "Contribution must be greater than zero.";
    if (input.date && !isValidDateString(input.date)) {
      return "Enter a valid date.";
    }
    return null;
  }

  function isValidDateString(s) {
    if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    var parts = s.split("-");
    var d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    return !isNaN(d.getTime()) &&
      d.getFullYear() === Number(parts[0]) &&
      d.getMonth() === Number(parts[1]) - 1 &&
      d.getDate() === Number(parts[2]);
  }

  /* ---------------------------- budget status --------------------------- */

  function statusLevel(pct) {
    if (pct >= 100) return "exceeded";
    if (pct >= WARNING_LEVEL) return "warning";
    return "ok";
  }

  function budgetStatus(transactions, monthKey) {
    monthKey = monthKey || currentMonthKey();
    var cfg = getBudgetsConfig();

    var spent = 0;
    var catSpent = {};
    (transactions || []).forEach(function (t) {
      if ((t.type || "").toLowerCase() !== "expense") return;
      if (monthKeyOf(t.date) !== monthKey) return;
      var amt = Number(t.amount) || 0;
      spent += amt;
      if (t.category) catSpent[t.category] = (catSpent[t.category] || 0) + amt;
    });
    spent = roundMoney(spent);

    var monthly = {
      budget: cfg.monthly,
      spent: spent,
      remaining: roundMoney(cfg.monthly - spent),
      pct: cfg.monthly > 0 ? roundMoney((spent / cfg.monthly) * 100) : 0,
      exceeded: cfg.monthly > 0 && spent > cfg.monthly,
      exceededBy: cfg.monthly > 0 ? roundMoney(Math.max(0, spent - cfg.monthly)) : 0,
      level: cfg.monthly > 0 ? statusLevel(spent / cfg.monthly * 100) : "none"
    };

    var categories = {};
    Object.keys(cfg.categories).forEach(function (cat) {
      var b = Number(cfg.categories[cat]) || 0;
      var s = roundMoney(catSpent[cat] || 0);
      categories[cat] = {
        budget: b,
        spent: s,
        remaining: roundMoney(b - s),
        pct: b > 0 ? roundMoney((s / b) * 100) : 0,
        exceeded: b > 0 && s > b,
        exceededBy: b > 0 ? roundMoney(Math.max(0, s - b)) : 0,
        level: b > 0 ? statusLevel(s / b * 100) : "none"
      };
    });

    return {
      monthKey: monthKey,
      monthly: monthly,
      categories: categories,
      hasMonthlyBudget: cfg.monthly > 0,
      hasCategoryBudgets: Object.keys(cfg.categories).length > 0
    };
  }

  /* ------------------------------- goals -------------------------------- */

  function getGoals() {
    var list = storage.getGoals();
    if (!Array.isArray(list)) return [];
    return list.map(function (g) {
      return {
        id: g.id,
        name: String(g.name || ""),
        target: Number(g.target) || 0,
        deadline: g.deadline || "",
        createdAt: g.createdAt,
        updatedAt: g.updatedAt,
        contributions: Array.isArray(g.contributions) ? g.contributions.slice() : []
      };
    });
  }

  function saveGoals(list) {
    storage.saveGoals(Array.isArray(list) ? list : []);
  }

  function addGoal(input) {
    var err = validateGoal(input);
    if (err) return { error: err };
    var now = Date.now();
    var goal = {
      id: uid(),
      name: String(input.name).trim(),
      target: roundMoney(Number(input.target)),
      deadline: input.deadline || "",
      createdAt: now,
      updatedAt: now,
      contributions: []
    };
    var list = getGoals();
    list.push(goal);
    saveGoals(list);
    return { goal: goal };
  }

  function updateGoal(id, input) {
    var list = getGoals();
    var goal = list.filter(function (g) { return g.id === id; })[0];
    if (!goal) return { error: "Goal not found." };
    var name = input.name != null ? String(input.name).trim() : goal.name;
    var target = input.target != null ? Number(input.target) : goal.target;
    var deadline = input.deadline != null ? input.deadline : goal.deadline;
    var err = validateGoal({ name: name, target: target, deadline: deadline });
    if (err) return { error: err };
    goal.name = name;
    goal.target = roundMoney(target);
    goal.deadline = deadline;
    goal.updatedAt = Date.now();
    saveGoals(list);
    return { goal: goal };
  }

  function deleteGoal(id) {
    var list = getGoals();
    var next = list.filter(function (g) { return g.id !== id; });
    if (next.length === list.length) return false;
    saveGoals(next);
    return true;
  }

  function addContribution(goalId, input) {
    var err = validateContribution(input);
    if (err) return { error: err };
    var list = getGoals();
    var goal = list.filter(function (g) { return g.id === goalId; })[0];
    if (!goal) return { error: "Goal not found." };
    var now = Date.now();
    goal.contributions.push({
      id: uid(),
      amount: roundMoney(Number(input.amount)),
      date: input.date || todayKey(),
      createdAt: now
    });
    goal.updatedAt = now;
    saveGoals(list);
    return { goal: goal };
  }

  function removeContribution(goalId, contributionId) {
    var list = getGoals();
    var goal = list.filter(function (g) { return g.id === goalId; })[0];
    if (!goal) return false;
    var before = goal.contributions.length;
    goal.contributions = goal.contributions.filter(function (c) { return c.id !== contributionId; });
    if (goal.contributions.length === before) return false;
    goal.updatedAt = Date.now();
    saveGoals(list);
    return true;
  }

  function computeGoalProgress(goal) {
    var contributed = (goal.contributions || []).reduce(function (sum, c) {
      return sum + (Number(c.amount) || 0);
    }, 0);
    contributed = roundMoney(contributed);
    var target = Number(goal.target) || 0;
    return {
      contributed: contributed,
      target: target,
      remaining: roundMoney(Math.max(0, target - contributed)),
      pct: target > 0 ? roundMoney(Math.min(100, (contributed / target) * 100)) : 0,
      completed: target > 0 && contributed >= target
    };
  }

  /* ------------------------------ public API ---------------------------- */

  ET.budgets = {
    WARNING_LEVEL: WARNING_LEVEL,
    getBudgetsConfig: getBudgetsConfig,
    saveBudgetsConfig: saveBudgetsConfig,
    setMonthlyBudget: setMonthlyBudget,
    setCategoryBudget: setCategoryBudget,
    removeCategoryBudget: removeCategoryBudget,
    hasCategoryBudget: hasCategoryBudget,
    validateMonthlyBudget: validateMonthlyBudget,
    validateCategoryBudget: validateCategoryBudget,
    validateGoal: validateGoal,
    validateContribution: validateContribution,
    budgetStatus: budgetStatus,
    getGoals: getGoals,
    saveGoals: saveGoals,
    addGoal: addGoal,
    updateGoal: updateGoal,
    deleteGoal: deleteGoal,
    addContribution: addContribution,
    removeContribution: removeContribution,
    computeGoalProgress: computeGoalProgress
  };
})(window);