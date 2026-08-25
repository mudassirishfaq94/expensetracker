/* =========================================================================
   reports.js — financial calculations for the Reports & Analytics page
   Pure functions that take a filtered transaction list and return computed
   data objects. No DOM, no Chart.js, no localStorage — just maths.

   Each function accepts a list of transactions (already filtered by type,
   date range, category etc.) and returns the relevant data.

   Attaches to: window.ET.reports
   ========================================================================= */
(function (global) {
  "use strict";

  var ET = (global.ET = global.ET || {});

  var MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];

  function roundMoney(n) {
    if (!isFinite(n)) return 0;
    return Math.round(n * 100) / 100;
  }

  function isIncome(record) {
    return (record.type || "").toLowerCase() === "income";
  }

  function isExpense(record) {
    return (record.type || "").toLowerCase() === "expense";
  }

  function monthKey(dateStr) {
    return (dateStr || "").slice(0, 7);
  }

  function monthLabel(key) {
    if (!key || key.length < 7) return key || "";
    var parts = key.split("-");
    var year = Number(parts[0]);
    var idx = Number(parts[1]) - 1;
    if (idx < 0 || idx > 11) return key;
    return MONTH_NAMES[idx].slice(0, 3) + " " + year;
  }

  /* ---------- Overview ---------- */
  function computeOverview(list) {
    var totalIncome = 0, totalExpenses = 0;
    var incomeCount = 0, expenseCount = 0;
    list.forEach(function (r) {
      var amt = Number(r.amount) || 0;
      if (isIncome(r)) { totalIncome += amt; incomeCount++; }
      else { totalExpenses += amt; expenseCount++; }
    });
    totalIncome = roundMoney(totalIncome);
    totalExpenses = roundMoney(totalExpenses);
    var balance = roundMoney(totalIncome - totalExpenses);
    var savingsRate = totalIncome > 0 ? roundMoney((balance / totalIncome) * 100) : null;
    return {
      totalIncome: totalIncome,
      totalExpenses: totalExpenses,
      balance: balance,
      savingsRate: savingsRate,
      incomeCount: incomeCount,
      expenseCount: expenseCount,
      totalCount: list.length
    };
  }

  /* ---------- Income vs Expenses (for chart) ---------- */
  function incomeVsExpense(list) {
    var overview = computeOverview(list);
    return {
      income: overview.totalIncome,
      expenses: overview.totalExpenses
    };
  }

  /* ---------- Category breakdowns ---------- */
  function expenseCategoryBreakdown(list) {
    var map = {};
    var total = 0;
    list.forEach(function (r) {
      if (!isExpense(r)) return;
      var amt = Number(r.amount) || 0;
      map[r.category] = (map[r.category] || 0) + amt;
      total += amt;
    });
    total = roundMoney(total);
    var rows = Object.keys(map).map(function (cat) {
      return {
        category: cat,
        amount: roundMoney(map[cat]),
        pct: total > 0 ? roundMoney((map[cat] / total) * 100) : 0
      };
    });
    rows.sort(function (a, b) { return b.amount - a.amount; });
    return { rows: rows, total: total };
  }

  function incomeCategoryBreakdown(list) {
    var map = {};
    var total = 0;
    list.forEach(function (r) {
      if (!isIncome(r)) return;
      var amt = Number(r.amount) || 0;
      map[r.category] = (map[r.category] || 0) + amt;
      total += amt;
    });
    total = roundMoney(total);
    var rows = Object.keys(map).map(function (cat) {
      return {
        category: cat,
        amount: roundMoney(map[cat]),
        pct: total > 0 ? roundMoney((map[cat] / total) * 100) : 0
      };
    });
    rows.sort(function (a, b) { return b.amount - a.amount; });
    return { rows: rows, total: total };
  }

  /* ---------- Monthly trend ---------- */
  function monthlyTrend(list) {
    var months = {};
    list.forEach(function (r) {
      var mk = monthKey(r.date);
      if (!mk) return;
      if (!months[mk]) months[mk] = { income: 0, expenses: 0 };
      var amt = Number(r.amount) || 0;
      if (isIncome(r)) months[mk].income += amt;
      else months[mk].expenses += amt;
    });
    var keys = Object.keys(months).sort();
    var data = keys.map(function (k) {
      var income = roundMoney(months[k].income);
      var expenses = roundMoney(months[k].expenses);
      return {
        monthKey: k,
        monthLabel: monthLabel(k),
        income: income,
        expenses: expenses,
        balance: roundMoney(income - expenses)
      };
    });
    return data;
  }

  /* ---------- Spending trend (daily for short range, monthly for long) ---------- */
  function spendingTrend(list, rangeDays) {
    if (rangeDays == null) rangeDays = 365;
    if (rangeDays <= 45) {
      var daily = {};
      list.forEach(function (r) {
        if (!isExpense(r)) return;
        var d = r.date;
        if (!d) return;
        daily[d] = (daily[d] || 0) + (Number(r.amount) || 0);
      });
      var dates = Object.keys(daily).sort();
      return {
        type: "daily",
        labels: dates,
        values: dates.map(function (d) { return roundMoney(daily[d]); })
      };
    }
    var monthly = {};
    list.forEach(function (r) {
      if (!isExpense(r)) return;
      var mk = monthKey(r.date);
      if (!mk) return;
      monthly[mk] = (monthly[mk] || 0) + (Number(r.amount) || 0);
    });
    var keys = Object.keys(monthly).sort();
    return {
      type: "monthly",
      labels: keys.map(function (k) { return monthLabel(k); }),
      values: keys.map(function (k) { return roundMoney(monthly[k]); })
    };
  }

  /* ---------- Top transactions ---------- */
  function topExpenses(list, count) {
    count = count || 10;
    var expenses = list.filter(isExpense);
    expenses.sort(function (a, b) { return (Number(b.amount) || 0) - (Number(a.amount) || 0); });
    return expenses.slice(0, count);
  }

  function topIncome(list, count) {
    count = count || 10;
    var incomes = list.filter(isIncome);
    incomes.sort(function (a, b) { return (Number(b.amount) || 0) - (Number(a.amount) || 0); });
    return incomes.slice(0, count);
  }

  /* ---------- Month-to-month comparison ---------- */
  function monthComparison(list) {
    var trend = monthlyTrend(list);
    if (trend.length < 2) return null;
    var current = trend[trend.length - 1];
    var previous = trend[trend.length - 2];
    function pctChange(curr, prev) {
      if (prev === 0 && curr === 0) return 0;
      if (prev === 0) return null;
      return roundMoney(((curr - prev) / prev) * 100);
    }
    return {
      currentMonth: current.monthLabel,
      previousMonth: previous.monthLabel,
      expenseChange: pctChange(current.expenses, previous.expenses),
      incomeChange: pctChange(current.income, previous.income),
      balanceChange: pctChange(current.balance, previous.balance),
      currentExpenses: current.expenses,
      previousExpenses: previous.expenses,
      currentIncome: current.income,
      previousIncome: previous.income,
      currentBalance: current.balance,
      previousBalance: previous.balance
    };
  }

  /* ---------- Insights ---------- */
  function generateInsights(list) {
    var insights = [];
    if (list.length < 2) {
      insights.push("Add more transactions to unlock financial insights.");
      return insights;
    }

    var overview = computeOverview(list);
    var trend = monthlyTrend(list);
    var comparison = monthComparison(list);

    /* Savings rate */
    if (overview.savingsRate != null) {
      insights.push("Your savings rate is " + overview.savingsRate + "%.");
    }

    /* Highest expense category this period */
    var expCat = expenseCategoryBreakdown(list);
    if (expCat.rows.length > 0) {
      var topCat = expCat.rows[0];
      insights.push("Your highest spending category is " + topCat.category + " — AED " + topCat.amount.toLocaleString("en-AE", { minimumFractionDigits: 2 }) + ".");
    }

    /* Largest expense single transaction */
    var topExp = topExpenses(list, 1);
    if (topExp.length > 0) {
      insights.push("Your largest expense was " + topExp[0].title + " for AED " + (Number(topExp[0].amount) || 0).toLocaleString("en-AE", { minimumFractionDigits: 2 }) + ".");
    }

    /* Month-to-month expense change */
    if (comparison && comparison.expenseChange != null) {
      var dir = comparison.expenseChange >= 0 ? "increased" : "decreased";
      insights.push("Expenses " + dir + " by " + Math.abs(comparison.expenseChange).toFixed(1) + "% compared to " + comparison.previousMonth + ".");
    }

    /* Month-to-month income change */
    if (comparison && comparison.incomeChange != null) {
      var dir2 = comparison.incomeChange >= 0 ? "increased" : "decreased";
      insights.push("Income " + dir2 + " by " + Math.abs(comparison.incomeChange).toFixed(1) + "% compared to " + comparison.previousMonth + ".");
    }

    return insights;
  }

  /* ---------- All-in-one convenience ---------- */
  function allReports(list) {
    return {
      overview: computeOverview(list),
      incomeVsExpense: incomeVsExpense(list),
      expenseCategory: expenseCategoryBreakdown(list),
      incomeCategory: incomeCategoryBreakdown(list),
      monthlyTrend: monthlyTrend(list),
      spendingTrend: spendingTrend(list),
      topExpenses: topExpenses(list),
      topIncome: topIncome(list),
      comparison: monthComparison(list),
      insights: generateInsights(list)
    };
  }

  /* ---------- Date range helpers ---------- */

  function filterByDateRange(list, range, startDate, endDate) {
    if (range === "all") return list;
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    var start = null, end = null;

    if (range === "custom") {
      start = startDate ? parseDate(startDate) : null;
      end = endDate ? parseDate(endDate) : null;
    } else {
      end = today;
      if (range === "this-month") {
        start = new Date(today.getFullYear(), today.getMonth(), 1);
      } else if (range === "last-month") {
        start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
        end = new Date(today.getFullYear(), today.getMonth(), 0);
      } else if (range === "last-3") {
        start = new Date(today.getFullYear(), today.getMonth() - 3, 1);
      } else if (range === "last-6") {
        start = new Date(today.getFullYear(), today.getMonth() - 6, 1);
      } else if (range === "this-year") {
        start = new Date(today.getFullYear(), 0, 1);
      }
    }

    if (!start) return list;

    return list.filter(function (r) {
      var d = parseDate(r.date);
      if (!d) return false;
      if (end) return d >= start && d <= end;
      return d >= start;
    });
  }

  function parseDate(s) {
    if (!s || typeof s !== "string") return null;
    var parts = s.split("-");
    if (parts.length !== 3) return null;
    var d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    return isNaN(d.getTime()) ? null : d;
  }

  /* ---------- Detect approximate range days for spending trend ---------- */
  function detectRangeDays(range, startDate, endDate) {
    if (range === "this-month" || range === "last-month") return 31;
    if (range === "last-3") return 92;
    if (range === "last-6") return 184;
    if (range === "this-year") return 365;
    if (range === "custom" && startDate && endDate) {
      var s = parseDate(startDate), e = parseDate(endDate);
      if (s && e) return Math.ceil((e - s) / 86400000);
    }
    return 365;
  }

  /* ---------- Filter by type ---------- */
  function filterByType(list, type) {
    if (!type || type === "all") return list;
    if (type === "income") return list.filter(isIncome);
    return list.filter(isExpense);
  }

  /* ---------- Filter by category ---------- */
  function filterByCategory(list, category) {
    if (!category) return list;
    return list.filter(function (r) { return r.category === category; });
  }

  /* ---------- Available categories from data ---------- */
  function availableCategories(list, type) {
    var filtered = type ? filterByType(list, type) : list;
    var cats = {};
    filtered.forEach(function (r) {
      if (r.category) cats[r.category] = true;
    });
    return Object.keys(cats).sort();
  }

  /* --------------------------------- public API -------------------------- */

  ET.reports = {
    computeOverview: computeOverview,
    incomeVsExpense: incomeVsExpense,
    expenseCategoryBreakdown: expenseCategoryBreakdown,
    incomeCategoryBreakdown: incomeCategoryBreakdown,
    monthlyTrend: monthlyTrend,
    spendingTrend: spendingTrend,
    topExpenses: topExpenses,
    topIncome: topIncome,
    monthComparison: monthComparison,
    generateInsights: generateInsights,
    allReports: allReports,
    filterByDateRange: filterByDateRange,
    filterByType: filterByType,
    filterByCategory: filterByCategory,
    availableCategories: availableCategories,
    detectRangeDays: detectRangeDays
  };
})(window);