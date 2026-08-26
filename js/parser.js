/* =========================================================================
   parser.js — rule-based natural language transaction parser
   Turns a free-text sentence into a structured transaction draft.

     parseTransactionText(text)
       -> { data, confidence, warnings, error }

     data = { type, title, amount, currency, category, vendor, date, notes }

   Rules only — no external APIs, works fully offline. The structure leaves a
   hook so a future AI parser can be plugged in as an optional fallback for
   low-confidence input (see parseTransaction below).

   Attaches to: window.ET.parser
   ========================================================================= */
(function (global) {
  "use strict";

  var ET = (global.ET = global.ET || {});

  var DEFAULT_CURRENCY = "AED";

  var MONTHS = {
    january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
    july: 6, august: 7, september: 8, october: 9, november: 10, december: 11
  };
  var WEEKDAYS = {
    sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4,
    friday: 5, saturday: 6
  };

  var CURRENCY_UNIT_RE = /AED|DHS|Dirhams?|د\.إ/i;
  var CURRENCY_GLOBAL = /AED|DHS|Dirhams?|د\.إ/gi;

  /* -------------------------- keyword tables --------------------------- */

  var INCOME_PHRASES = [
    "received", "receive", "earned", "earn", "salary", "wage", "paycheck",
    "got paid", "payment received", "income", "freelance payment",
    "client paid", "customer paid", "profit", "bonus", "refund",
    "rent received", "gifted", "dividend", "investment", "tenant",
    "upwork", "fiverr", "payroll", "deposited", "credited"
  ];

  var EXPENSE_PHRASES = [
    "bought", "buy", "purchased", "purchase", "spent", "spend", "spending",
    "paid for", "ordered", "ate", "bill", "recharge", "subscription",
    "charged", "billing", "withdrawn", "wasted"
  ];

  var EXPENSE_CATEGORY_KEYWORDS = {
    "Food & Groceries": [
      "grocery", "groceries", "supermarket", "carrefour", "sugar", "food",
      "lunch", "dinner", "breakfast", "restaurant", "cafe", "coffee",
      "snacks", "starbucks", "kfc", "mcdonald"
    ],
    "Transport": [
      "petrol", "fuel", "taxi", "uber", "careem", "metro", "bus", "parking",
      "car", "enoc", "adnoc"
    ],
    "Shopping": [
      "clothes", "shoes", "amazon", "electronics", "phone", "laptop",
      "shirt", "t-shirt", "dress", "watch", "bag"
    ],
    "Bills": [
      "electricity", "water", "internet", "wifi", "phone bill", "recharge",
      "dewa", "etisalat", "du", "utility", "bill"
    ],
    "Entertainment": [
      "netflix", "cinema", "movie", "game", "spotify", "subscription",
      "concert", "entertainment"
    ],
    "Health": [
      "doctor", "medicine", "pharmacy", "hospital", "gym", "dentist", "clinic"
    ],
    "Education": [
      "course", "udemy", "books", "university", "school", "tuition", "coursera"
    ],
    "Rent": ["rent", "apartment", "accommodation"],
    "Travel": ["flight", "hotel", "airbnb", "booking", "travel"]
  };

  var INCOME_CATEGORY_KEYWORDS = {
    "Salary": ["salary", "paycheck", "monthly salary", "wage", "payroll"],
    "Freelance": [
      "freelance", "client", "project payment", "upwork", "fiverr", "freelancing"
    ],
    "Business": ["business", "customer payment", "sale", "profit", "sales"],
    "Investment": ["investment", "dividend", "stocks", "crypto", "interest", "shares"],
    "Rental Income": ["rent received", "tenant", "rental income"],
    "Gift": ["gift", "gifted"],
    "Refund": ["refund", "refunded"],
    "Other Income": []
  };

  var KNOWN_VENDORS = {
    "lulu hypermarket": "Lulu Hypermarket",
    "carrefour": "Carrefour",
    "enoc": "ENOC",
    "adnoc": "ADNOC",
    "netflix": "Netflix",
    "lulu": "Lulu",
    "amazon": "Amazon",
    "careem": "Careem",
    "uber": "Uber",
    "etisalat": "Etisalat",
    "dewa": "DEWA",
    "spotify": "Spotify",
    "udemy": "Udemy",
    "fiverr": "Fiverr",
    "upwork": "Upwork",
    "starbucks": "Starbucks",
    "mcdonald": "McDonald's",
    "aster": "Aster",
    "vox": "Vox",
    "uniqlo": "Uniqlo",
    "coursera": "Coursera"
  };

  var VENDOR_STOP = [
    "freelance", "work", "project", "salary", "job", "client", "customer",
    "employer", "boss", "tenant", "bank", "office", "school", "my"
  ];

  var TITLE_STOP = {
    "i": 1, "i've": 1, "i'm": 1, "im": 1, "we": 1, "we've": 1, "my": 1,
    "me": 1, "our": 1, "us": 1, "the": 1, "a": 1, "an": 1, "just": 1,
    "then": 1, "have": 1, "had": 1, "was": 1, "were": 1, "got": 1, "am": 1,
    "bought": 1, "buy": 1, "purchased": 1, "purchase": 1, "paid": 1,
    "pay": 1, "paying": 1, "spent": 1, "spend": 1, "spending": 1,
    "received": 1, "receive": 1, "receiving": 1, "earned": 1, "earn": 1,
    "earning": 1, "ordered": 1, "order": 1, "ate": 1, "eat": 1,
    "need": 1, "want": 1, "wants": 1, "sent": 1, "send": 1, "gave": 1,
    "give": 1, "wasted": 1, "recharged": 1, "withdrew": 1,
    "for": 1, "on": 1, "to": 1, "of": 1, "in": 1, "at": 1, "from": 1,
    "with": 1, "about": 1, "towards": 1, "also": 1, "and": 1, "or": 1
  };

  var MSG_MULTI = "This looks like it may contain multiple transactions. Please enter one transaction at a time.";
  var MSG_GIBBERISH = "Couldn't understand this transaction. Please enter an amount or describe the transaction in more detail.";
  var MSG_AMOUNT = "Please include an amount so Ledger can record this, e.g. \u201C12 AED\u201D.";

  /* ----------------------------- helpers ------------------------------ */

  function escRe(str) {
    return String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function normalizeNumber(str) {
    var n = parseFloat(String(str).replace(/,/g, ""));
    return isFinite(n) ? Math.round(n * 100) / 100 : null;
  }

  function pad2(n) { return String(n).padStart(2, "0"); }

  function ymd(d) {
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }

  function addDays(d, n) {
    var x = new Date(d);
    x.setDate(x.getDate() + n);
    return x;
  }

  function isValidDate(d) { return !isNaN(d.getTime()); }

  function todayNoon() {
    var d = new Date();
    d.setHours(12, 0, 0, 0);
    return d;
  }

  function titleCase(str) {
    return String(str).split(/\s+/).filter(Boolean).map(function (w) {
      if (/^[a-z]+$/.test(w)) return w.charAt(0).toUpperCase() + w.slice(1);
      return w;
    }).join(" ");
  }

  /* --------------------------- date detection ------------------------- */

  function detectDate(text) {
    var lower = text.toLowerCase();
    var today = todayNoon();
    var matched = null;

    /* YYYY-MM-DD */
    var m = /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/.exec(text);
    if (m) {
      var d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
      if (isValidDate(d)) matched = { date: d, span: [m.index, m.index + m[0].length], removed: m[0] };
    }

    /* DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY */
    if (!matched) {
      m = /\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})\b/.exec(text);
      if (m) {
        var day = Number(m[1]), mon = Number(m[2]), yr = Number(m[3]);
        if (yr < 100) yr += 2000;
        if (mon > 12 && day <= 12) { var tmp = day; day = mon; mon = tmp; }
        d = new Date(yr, mon - 1, day);
        if (isValidDate(d)) matched = { date: d, span: [m.index, m.index + m[0].length], removed: m[0] };
      }
    }

    /* "25 August [2026]" / "25th of August" */
    if (!matched) {
      m = /\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?([A-Za-z]{3,9})(?:[,]?\s+(\d{2,4}))?\b/.exec(text);
      if (m && MONTHS[m[2].toLowerCase()] !== undefined) {
        var dayN = Number(m[1]);
        var monN = MONTHS[m[2].toLowerCase()];
        var yrN = m[3] != null ? Number(m[3]) : null;
        if (yrN != null && yrN < 100) yrN += 2000;
        d = makeMonthDay(dayN, monN, yrN, today);
        if (d) matched = { date: d, span: [m.index, m.index + m[0].length], removed: m[0] };
      }
    }

    /* "August 25" */
    if (!matched) {
      m = /\b([A-Za-z]{3,9})\s+(\d{1,2})(?:st|nd|rd|th)?(?!\d)(?:[,]?\s+(\d{2,4}))?\b/.exec(text);
      if (m && MONTHS[m[1].toLowerCase()] !== undefined) {
        var monN2 = MONTHS[m[1].toLowerCase()];
        var dayN2 = Number(m[2]);
        var yrN2 = m[3] != null ? Number(m[3]) : null;
        if (yrN2 != null && yrN2 < 100) yrN2 += 2000;
        d = makeMonthDay(dayN2, monN2, yrN2, today);
        if (d) matched = { date: d, span: [m.index, m.index + m[0].length], removed: m[0] };
      }
    }

    /* today / tomorrow / yesterday */
    if (!matched) {
      m = /\b(today|tomorrow|yesterday)\b/.exec(lower);
      if (m) {
        var delta = m[1] === "yesterday" ? -1 : m[1] === "tomorrow" ? 1 : 0;
        var idx = lower.indexOf(m[1]);
        matched = { date: addDays(today, delta), span: [idx, idx + m[1].length], removed: m[1] };
      }
    }

    /* last monday / last friday ... */
    if (!matched) {
      m = /\blast\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/.exec(lower);
      if (m) {
        var target = WEEKDAYS[m[1]];
        var cur = today.getDay();
        var back = (cur - target + 7) % 7;
        if (back === 0) back = 7;
        var idx2 = lower.indexOf(m[0]);
        matched = { date: addDays(today, -back), span: [idx2, idx2 + m[0].length], removed: m[0] };
      }
    }

    if (!matched) return { date: null, key: null, explicit: false, spans: [], cleaned: text };

    var start = matched.span[0], end = matched.span[1];
    var pre = text.slice(0, start);
    var preMatch = /\b(?:on|for|at|in|the)\s+$/i.exec(pre);
    if (preMatch) start = start - preMatch[0].length;
    var cleaned = text.slice(0, start) + " " + text.slice(end);
    cleaned = cleaned.replace(/\s+/g, " ").trim();

    return {
      date: matched.date,
      key: ymd(matched.date),
      explicit: true,
      spans: [[start, end]],
      cleaned: cleaned
    };
  }

  function makeMonthDay(day, mon, year, today) {
    var y = year != null ? year : today.getFullYear();
    var d = new Date(y, mon, day);
    if (!isValidDate(d)) return null;
    if (year == null) {
      var todayKey = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      if (d > todayKey) d = new Date(y - 1, mon, day);
    }
    return isValidDate(d) ? d : null;
  }

  /* --------------------------- amount detection ----------------------- */

  function detectAmount(text, dateSpans) {
    var nums = [];
    var re = /(\d[\d,]*(?:\.\d+)?)/g;
    var m;
    while ((m = re.exec(text)) !== null) {
      var val = normalizeNumber(m[1]);
      if (val == null) continue;
      var inside = dateSpans.some(function (s) { return m.index >= s[0] && m.index < s[1]; });
      if (inside) continue;
      var before = text.slice(Math.max(0, m.index - 8), m.index);
      var after = text.slice(m.index + m[0].length, m.index + m[0].length + 8);
      var tagged = CURRENCY_UNIT_RE.test(before + " " + after);
      nums.push({ value: val, raw: m[1], index: m.index, tagged: tagged });
    }

    var taggedNums = nums.filter(function (n) { return n.tagged; });
    if (taggedNums.length > 1) return { amount: null, error: MSG_MULTI, raw: null, index: -1 };

    var chosen = null;
    if (taggedNums.length === 1) {
      chosen = taggedNums[0];
    } else if (nums.length === 1) {
      chosen = nums[0];
    } else if (nums.length > 1) {
      if (/\b(?:and|or|also|plus|then)\b/i.test(text)) {
        return { amount: null, error: MSG_MULTI, raw: null, index: -1 };
      }
      nums.sort(function (a, b) { return b.value - a.value; });
      chosen = nums[0];
    }

    if (!chosen) return { amount: null, error: null, raw: null, index: -1 };
    return { amount: chosen.value, raw: chosen.raw, index: chosen.index, error: null };
  }

  /* --------------------------- category detection --------------------- */

  function matchCategory(text, map) {
    var lower = " " + text.toLowerCase() + " ";
    var chosen = null, chosenLen = -1;
    Object.keys(map).forEach(function (cat) {
      (map[cat] || []).forEach(function (kw) {
        if (!kw) return;
        var re = kw.length <= 3
          ? new RegExp("\\b" + escRe(kw) + "\\b")
          : new RegExp("\\b" + escRe(kw));
        if (!re.test(lower)) return;
        if (kw.length > chosenLen) {
          chosen = cat;
          chosenLen = kw.length;
        }
      });
    });
    return chosen;
  }

  function detectCategoryAny(text) {
    var a = matchCategory(text, EXPENSE_CATEGORY_KEYWORDS);
    var b = matchCategory(text, INCOME_CATEGORY_KEYWORDS);
    if (a && b) {
      var la = keywordLen(text, EXPENSE_CATEGORY_KEYWORDS[a]);
      var lb = keywordLen(text, INCOME_CATEGORY_KEYWORDS[b]);
      return la >= lb ? a : b;
    }
    return a || b;
  }

  function keywordLen(text, kws) {
    var lower = text.toLowerCase();
    var len = -1;
    (kws || []).forEach(function (kw) {
      var idx = lower.indexOf(kw);
      if (idx !== -1 && kw.length > len) len = kw.length;
    });
    return len;
  }

  function isIncomeCategory(cat) {
    return Object.prototype.hasOwnProperty.call(INCOME_CATEGORY_KEYWORDS, cat);
  }

  function isExpenseCategory(cat) {
    return Object.prototype.hasOwnProperty.call(EXPENSE_CATEGORY_KEYWORDS, cat);
  }

  /* ----------------------------- type detection ----------------------- */

  function detectType(text, category) {
    var lower = text.toLowerCase();
    var income = 0, expense = 0;

    INCOME_PHRASES.forEach(function (p) {
      if (lower.indexOf(p) !== -1) income++;
    });
    EXPENSE_PHRASES.forEach(function (p) {
      if (lower.indexOf(p) !== -1) expense++;
    });

    /* bare "paid" is usually an expense, unless someone paid me */
    if (/\bpaid\b/.test(lower)) {
      if (/(?:client|customer|company|employer|boss|someone|they|she|he)\s+paid|got\s+paid|paid\s+(?:me|us)\b/.test(lower)) {
        income += 3;
      } else {
        expense += 1;
      }
    }

    if (income !== expense) return income > expense ? "income" : "expense";

    if (income > 0) return null; /* conflicting signals — ambiguous */

    /* category implies a type */
    if (category) {
      if (isIncomeCategory(category)) return "income";
      if (isExpenseCategory(category)) return "expense";
    }
    return null;
  }

  /* ----------------------------- vendor detection --------------------- */

  function detectVendor(text) {
    var lower = text.toLowerCase();

    var keys = Object.keys(KNOWN_VENDORS).sort(function (a, b) { return b.length - a.length; });
    for (var i = 0; i < keys.length; i++) {
      if (lower.indexOf(keys[i]) !== -1) return KNOWN_VENDORS[keys[i]];
    }

    var re = /(?:from|at|to)\s+([A-Z][A-Za-z0-9&'.-]*(?:\s+[A-Z][A-Za-z0-9&'.-]*)?)/g;
    var m, best = null;
    while ((m = re.exec(text)) !== null) {
      var low = m[1].toLowerCase();
      var skip = VENDOR_STOP.some(function (s) { return low.indexOf(s) !== -1; });
      if (skip) continue;
      if (best === null) best = m[1];
    }
    return best;
  }

  /* ----------------------------- title extraction --------------------- */

  function detectTitle(source, type, category) {
    var s = " " + source.replace(/\s+/g, " ").trim() + " ";
    var m, raw = "";

    var patterns = [
      /(?:bought|purchased)\s+([A-Za-z][A-Za-z0-9&'. -]*?)\s+(?:from|for|at|on|with)\b/i,
      /(?:paid|spent|spend|spending)\s+(?:for|on|towards)\s+([A-Za-z][A-Za-z0-9&'. -]*?)\s*$/i,
      /received\s+(?:my\s+)?([A-Za-z][A-Za-z0-9&'. -]*?)\s+of\b/i,
      /(?:client|customer|company|employer)\s+paid\s+(?:me|us)?\s*(?:for|to|in)\s+([A-Za-z][A-Za-z0-9&'. -]*?)\s*$/i,
      /earned\s+(?:from|via)\s+([A-Za-z][A-Za-z0-9&'. -]*?)\s*$/i,
      /earned\s+([A-Za-z][A-Za-z0-9&'. -]*?)\s*(?:from|this|via|for|today|yesterday)\b/i,
      /received\s+([A-Za-z][A-Za-z0-9&'. -]*?)\s*(?:from|this|via|today|yesterday|as|as\s+my)\b/i,
      /(?:recharged|filled)\s+([A-Za-z][A-Za-z0-9&'. -]*?)\s*$/i
    ];

    for (var i = 0; i < patterns.length; i++) {
      m = patterns[i].exec(s);
      if (m && m[1] && m[1].trim()) { raw = m[1].trim(); break; }
    }

    if (!raw) raw = fallbackTitle(source);
    if (!raw) raw = fallbackForEmpty(type, category);

    raw = raw.replace(/\b(?:aed|dhs|dirhams?)\b/gi, "");
    raw = raw.replace(/\s+/g, " ").trim();
    raw = raw.replace(/[.,;:!?]+$/, "");
    if (!raw) raw = fallbackForEmpty(type, category);

    return titleCase(raw);
  }

  function fallbackTitle(source) {
    var words = source.split(/\s+/).filter(Boolean);
    while (words.length) {
      var first = words[0].toLowerCase();
      if (TITLE_STOP[first]) { words.shift(); continue; }
      if (/(?:client|customer|company|employer|boss)\s+(?:paid|sent|gave)/.test(words.slice(0, 2).join(" ").toLowerCase())) {
        words.shift(); words.shift(); continue;
      }
      break;
    }
    while (words.length && TITLE_STOP[words[words.length - 1].toLowerCase()]) words.pop();
    return words.join(" ");
  }

  function fallbackForEmpty(type, category) {
    if (type === "income") {
      return category && category !== "Other Income" ? category : "Income";
    }
    return category && category !== "Other" ? category : "Transaction";
  }

  /* ------------------------------ main parse -------------------------- */

  function parseWithRules(text) {
    var raw = String(text == null ? "" : text).trim();
    if (raw.length < 2) {
      return { data: null, confidence: "low", warnings: [], error: MSG_GIBBERISH };
    }

    var dateRes = detectDate(raw);
    var amountRes = detectAmount(raw, dateRes.spans);
    if (amountRes.error) {
      return { data: null, confidence: "low", warnings: [], error: amountRes.error };
    }

    var anyCat = detectCategoryAny(raw);
    var type = detectType(raw, anyCat);
    var warnings = [];

    if (!type && anyCat) {
      type = isIncomeCategory(anyCat) ? "income" : "expense";
    }
    if (!type) {
      warnings.push("The transaction type could not be determined — please review it.");
    }

    var map = type === "income" ? INCOME_CATEGORY_KEYWORDS : EXPENSE_CATEGORY_KEYWORDS;
    var category = matchCategory(raw, map) || anyCat || null;
    if (!category) category = type === "income" ? "Other Income" : "Other";

    var vendor = detectVendor(raw);

    var titleSource = dateRes.cleaned;
    if (amountRes.raw) {
      titleSource = titleSource.replace(new RegExp(escRe(amountRes.raw)), " ");
    }
    titleSource = titleSource.replace(CURRENCY_GLOBAL, " ");
    if (vendor) {
      titleSource = titleSource.replace(
        new RegExp("\\b(?:from|at|to)\\s+" + escRe(vendor), "i"),
        " "
      );
    }
    titleSource = titleSource.replace(/\s+/g, " ").trim();

    var title = detectTitle(titleSource, type, category);

    if (vendor && title.toLowerCase() === vendor.toLowerCase()) {
      vendor = "";
    }

    if (amountRes.amount == null) {
      var recognizable = type || anyCat ||
        /(?:bought|paid|spent|received|earned|salary|rent|bill|subscription|refund)/i.test(raw);
      return {
        data: null,
        confidence: "low",
        warnings: [],
        error: recognizable ? MSG_AMOUNT : MSG_GIBBERISH
      };
    }

    var confidence = "low";
    if (type && title) confidence = "high";
    else if (type || title) confidence = "medium";
    if (!type) confidence = "low";
    if (confidence === "high" && (!category || category === "Other" || category === "Other Income")) {
      confidence = "medium";
    }

    var data = {
      type: type || "expense",
      title: title,
      amount: amountRes.amount,
      currency: (ET.settings ? ET.settings.getCurrency() : DEFAULT_CURRENCY),
      category: category,
      vendor: vendor || "",
      date: dateRes.key || ymd(new Date()),
      notes: ""
    };

    return {
      data: data,
      confidence: confidence,
      warnings: warnings,
      error: null
    };
  }

  /* ------------------------------ public API -------------------------- */

  /**
   * Synchronous, rule-based entry point.
   */
  function parseTransactionText(text) {
    return parseWithRules(text);
  }

  /**
   * Async wrapper — the single entry point future code should call.
   * A future AI parser can be slotted in here as an optional fallback when
   * rule-based confidence is low. The app works fully offline today.
   */
  function parseTransaction(text) {
    var ruleBasedResult = parseWithRules(text);

    if (ruleBasedResult.confidence === "low" && !ruleBasedResult.error) {
      /* Future: optional AI fallback goes here.
         const aiResult = await aiParse(text);
         if (aiResult.confidence > ruleBasedResult.confidence) return aiResult; */
    }

    return Promise.resolve(ruleBasedResult);
  }

  ET.parser = {
    parseTransactionText: parseTransactionText,
    parseTransaction: parseTransaction
  };
})(window);
