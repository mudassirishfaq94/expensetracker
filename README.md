# Ledger — Personal Finance Tracker

A calm, local-first income and expense tracker. Tracks both income and expense
transactions entirely in the browser via `localStorage`. No backend, no
accounts, no external services — your data never leaves the browser.

> Completed phases:
> **Part 1** — expense-only core foundation (dashboard, CRUD, filters).
> **Part 2** — income + expense transaction system with a financial summary.
> **Part 3** — natural-language transaction input (smart entry).
> **Part 4** — Google Sheets integration and automatic transaction sync.
> **Part 4.5** — Google Sheets formatting, live financial calculations and a
> built-in Summary sheet.
> **Part 5** — Reports, analytics and financial insights page with charts.
> **Part 5.1** — Fix reports filter reset and empty-state recovery bug.
> **Part 6** — Monthly budgets, category budgets, budget warnings, and
> savings goals with contribution tracking.
> **Part 7** — Recurring transactions, subscription tracking, automatic
> generation with duplicate protection, and upcoming-payment reminders.
> The next phase will add export/backup, notifications and polish.

## Features

### Recurring transactions & subscriptions (Part 7)

- **Recurring definitions** — create income or expense transactions that
  repeat Daily, Weekly, Monthly, or Yearly, with start date, next due date,
  category, vendor, notes, and Active/Paused status. Stored separately from
  real transactions (`et_recurring_v1`).
- **Automatic generation** — `processRecurringTransactions()` turns due
  recurring items into real transactions through the existing
  `addTransaction()` path, so they instantly flow into the Dashboard, Reports,
  Budgets, and Google Sheets sync. Safe to run repeatedly.
- **Duplicate prevention** — each recurrence period is generated exactly once,
  guarded by the `recurringId` + date link on generated transactions AND by
  advancing `nextDueDate` after processing.
- **Safe catch-up** — missed periods (e.g. the app was closed for weeks) are
  generated with a per-item limit of 12 per cycle, with a warning when the
  limit is hit; remaining periods continue on the next cycle.
- **Reliable due dates** — `calculateNextDueDate()` handles month-ends (31 Jan
  → 28 Feb → 31 Mar) and leap years (29 Feb only lands on leap years).
- **Upcoming payments** — an Upcoming section groups due items into Today,
  Next 7 Days, Next 30 Days (plus Overdue), and the Dashboard shows a compact
  Upcoming Payments widget with a View All link.
- **Subscriptions** — mark an expense as a subscription; the Subscriptions tab
  shows Active count, total monthly cost (yearly/weekly/daily converted to an
  estimated monthly equivalent, clearly labelled), and upcoming payments this
  month.
- **Pause & Resume** — paused items never generate; resuming with a valid
  future due date continues normally.
- **Edit & Delete** — editing affects only future generations; deleting asks
  for confirmation and keeps all historical transactions.
- **Validation** — empty titles, invalid/zero amounts, missing frequencies, and
  invalid dates are rejected with clear messages.

### Reports & analytics (Part 5)

- **Dedicated Reports page** — activated in the sidebar, with professional
  layout, full responsive design, and dynamic filtering.
- **Date range filters** — This Month, Last Month, Last 3/6 Months, This Year,
  All Time, and Custom Range. Every chart and total updates instantly.
- **Transaction type filter** — All Transactions, Income Only, Expenses Only.
- **Category filter** — dynamically populated from your transaction data.
- **Overview cards** — Total Income, Total Expenses, Net Balance, and Savings
  Rate (Net ÷ Income × 100, safely handles zero income).
- **Income vs Expenses chart** — bar chart comparing totals.
- **Expense category breakdown** — doughnut chart with amounts and percentages.
- **Income category breakdown** — separate doughnut chart.
- **Monthly financial trend** — line chart with Income, Expenses, and Net
  Balance per month, including a dashed net line.
- **Spending trend** — line chart showing daily spending for short ranges and
  monthly spending for longer ranges (auto-chooses granularity).
- **Largest expenses** and **largest income** — sorted lists with rank, title,
  category, date, and amount.
- **Financial insights** — automatically generated from your data: highest
  category, largest transaction, month-over-month income/expense changes,
  savings rate. Shows "Add more transactions to unlock insights" when data is
  sparse.
- **Month-to-month comparison** — calculates percentage change in income,
  expenses, and balance between the two most recent months. Handles zero
  previous values safely.
- **Chart.js** — clean, lightweight charts with consistent palette. Charts are
  properly destroyed and recreated on filter changes — no memory leaks or
  duplicate instances.
- **No data states** — every chart and section shows a clear message when
  there are no transactions, no income, or no expenses for the selected period.
- **Local data first** — reports use immediate LocalStorage data, never wait
  for Google Sheets sync. All calculations are pure functions in
  `js/reports.js`.

## Features

### Google Sheets sync (Part 4)

- **Dedicated Google Sheets page** — connection status (Not Connected /
  Connected / Syncing / Sync Failed), last-sync time, spreadsheet name, and a
  beginner-friendly 7-step setup guide.
- **Config-based integration** — paste your Google Apps Script **Web App URL**
  plus spreadsheet/sheet names. The config is saved locally; no Google
  credentials, API keys, or tokens ever touch the frontend.
- **Built-in Google Apps Script** — copy the provided `Code.gs` (one click),
  paste it into your spreadsheet's Apps Script editor, deploy as a Web App
  (run as Me, access Anyone), and paste the URL back into Ledger.
- **Test Connection** button with friendly errors (invalid URL, unreachable
  script, timeout, etc.).
- **Automatic sync** — transactions saved manually or via natural-language
  entry sync to Google Sheets immediately after saving locally. LocalStorage
  stays the instant source; the app never waits for Google.
- **Duplicate protection** — every row is keyed by the unique transaction ID;
  the Apps Script updates an existing row instead of appending a new one, so
  refreshes and retries never create duplicates.
- **Per-transaction sync status** — a small badge in the transaction list shows
  **Synced**, **Pending**, or **Failed** (click a failed badge to retry).
- **Sync All** and **Sync Existing Transactions** buttons, plus a retry queue
  for failed deletions — nothing is silently lost when the internet drops.
- **Offline-safe** — if Google Sheets is unreachable the transaction stays in
  LocalStorage, is marked Pending/Failed, and can be retried later.
- **Edit & delete sync** — edits update the matching Google Sheets row; deletes
  remove the matching row (with retry if the remote delete fails).
- **Disconnect** removes only the saved connection config — all local
  transactions and your spreadsheet are untouched.

### Google Sheets formatting & summary (Part 4.5)

- **Professional Transactions sheet** — bold, frozen header row with dark-green
  background, white text, borders, and centered alignment. Column widths are
  set to readable sizes (Title 220px, Vendor 200px, Notes 250px, etc.) with
  text wrapping enabled for long fields.
- **Date formatting** — the Date column displays as `dd mmm yyyy` (e.g. 25 Aug
  2026). Created At and Updated At show as `dd mmm yyyy, hh:mm AM/PM`. All
  timestamps are stored as real Google Sheets Date objects, never raw ISO
  strings.
- **Amount formatting** — numbers stored as `#,##0.00` with thousands separators
  and two decimal places. The Currency column is center-aligned.
- **Conditional formatting** — Income rows get a subtle green tint; Expense rows
  get a subtle red tint. Rows are easy to scan without being distracting.
- **Summary sheet** — a separate `Summary` tab with live formulas:
  - **Overall** — Total Income, Total Expenses, Net Balance (`SUMIF`)
  - **Current Month** — Income This Month, Expenses This Month, Net Balance
    (`SUMIFS` with `EOMONTH`)
  - **Statistics** — Total Transactions, Income/Expense counts, Average Expense,
    Largest Expense, Largest Income
  - **Expenses by Category** and **Income by Category** — live `QUERY` formulas
    that automatically include new categories
  - **Monthly Summary** — a table of every month's Income, Expenses, and Net
    Balance (powered by helper columns M/N/O on Transactions with `ARRAYFORMULA`
    / `SUMIF` / `SORT` / `UNIQUE`)
- **`initializeSpreadsheet()`** — safe to run any number of times via the Apps
  Script editor. It never deletes data, never duplicates headers, never
  overwrites manually entered values. Existing transactions are migrated
  (string amounts converted to numbers, ISO timestamps to Date objects, legacy
  "expense" type normalized to "Expense").

### Budgets & goals (Part 6)

- **Monthly budget** — set a monthly spending limit. Ledger tracks this
  month's expense total against it: spent, remaining, and percent used with a
  progress bar.
- **Budget warnings** — at 80% usage a warning is shown; at 100%+ the budget is
  marked exceeded with the overage amount.
- **Category budgets** — per-category monthly limits (Food & Groceries,
  Transport, Rent, …) with the same spent / remaining / percent / exceeded
  tracking. Duplicate budgets for the same category are rejected.
- **Savings goals** — create goals with a name, target amount, and optional
  deadline; add contributions over time; track contributed, remaining,
  progress percent, and a Completed badge at 100%.
- **Validation everywhere** — negative or zero budgets/targets/contributions,
  empty goal names, invalid dates, and duplicate category budgets all produce
  clear inline error messages instead of bad data.
- **Contributions never count as expenses** — goal contributions are stored
  separately from transactions and never affect budget or report totals.
- **Dashboard integration** — the dashboard shows a monthly budget panel and a
  savings-goals widget; both update automatically whenever transactions,
  budgets, or goals change.
- **Dedicated page** — a "Budgets & Goals" section in the sidebar manages
  budgets and goals, backed by `localStorage` keys `et_budgets_v1` and
  `et_goals_v1`.

### Smart entry (natural language)

- **Add Transaction Quickly** panel at the top of the Dashboard — type a normal
  sentence such as "I bought sugar from Carrefour for 12 AED" and click
  **Analyze Transaction** (or press Enter).
- **Rule-based parser** (`js/parser.js`) detects transaction type (income /
  expense), amount, currency (AED, DHS, Dirhams, …), date (today, yesterday,
  last Friday, 25/08/2026, …), category, and vendor/source — fully offline,
  no AI APIs.
- **Review screen** — nothing is saved automatically. Every detected field is
  shown in a confirmation drawer where you can correct anything before saving.
  Low-confidence parses clearly prompt you to review the details.
- **Example chips** below the input fill the box with a sample sentence.
- **Graceful errors** — vague text, missing amounts, and multiple transactions
  in one sentence show clear messages instead of saving anything.
- Built so a future AI parser can be added later as an optional fallback for
  low-confidence input; the manual form and smart entry share the same
  `addTransaction()` save path.

### Transactions (income + expenses)

- **Unified transaction system** — every record is an income or expense.
  Legacy Part 1 expense data is automatically migrated (missing `type` is
  treated as `expense`), so nothing is lost.
- **Add / edit / delete** income and expenses through a slide-in form with
  inline validation (title, amount > 0, category, and date are required).
- **Transaction type selector** — toggle between Expense (default) and Income;
  the category list switches automatically (10 expense categories, 8 income
  categories).
- **Edit both types** — load the correct type and category list, and freely
  change a transaction between Expense and Income without losing data.
- **Transaction list** — both income and expenses shown together in a table on
  desktop and cards on mobile, always newest-first (same-date ties broken by
  `createdAt`). Each row shows the type badge, date, title, category,
  store/source, signed amount, and edit/delete actions.
- **Search & filters** — instant search (title/vendor), type filter
  (All / Income / Expenses), category filter, and month filter. All filters
  combine (e.g. Income → Salary → August 2026).
- **Sample data** loadable on demand (income + expenses). Never auto-seeded,
  so once you delete it, it stays gone.

### Dashboard

- **Total balance** — income minus expenses, all time.
- **Total income** and **Total expenses** cards with plus/minus indicators.
- **This month's balance** — this month's income minus expenses.
- **Today's spending** — only today's expenses.
- **Total transactions** counter (income and expense counts).
- **Financial summary** — income vs expenses (total income, total expenses,
  net balance) and current-month summary (income this month, expenses this
  month, remaining balance this month). All calculations are date-accurate.
- **Spending by category** (current month) and a **recent activity** feed.
- Everything recomputes automatically whenever a transaction is added, edited,
  or deleted.

### Navigation

- Dashboard, Transactions, Income, Expenses, plus Reports / Google Sheets /
  Settings marked "Soon".
- Income and Expenses open the single Transactions page pre-filtered to that
  type — one transaction system, no duplicate pages.

## Tech

Plain **HTML + CSS + JavaScript**. No framework, no build step, no dependencies.
Fonts (Fraunces + Plus Jakarta Sans) load from Google Fonts when online and fall
back to system fonts otherwise. Data is stored in `localStorage` under the key
`et_expenses_v1`.

## Getting started

Just open `index.html` in any modern browser (double-click it, or drag it into a
browser window). That's it.

If your browser is strict about `file://`, you can serve the folder instead:

```bash
# Python 3
python -m http.server 8000
# then visit http://localhost:8000
```

## Project structure

```
/index.html        Markup: sidebar, dashboard (with smart input), transactions + Google Sheets views, drawer, modal
/css/style.css     Full design system (tokens, components, responsive)
/js/storage.js     localStorage layer, migration, id generation, sample data, sheets config
/js/transactions.js  Domain logic: CRUD, filtering, sorting, statistics
/js/expenses.js    Compatibility shim (aliases ET.expenses to ET.transactions)
/js/parser.js      Rule-based natural-language parser (smart entry)
/js/googleSheets.js  Google Sheets sync layer (config, test, send/update/delete, retries)
/js/reports.js      Pure calculation engine (overview, category breakdowns, trends, insights)
/js/budgets.js      Budgets & goals domain logic (monthly/category limits, goals, validation)
/js/recurring.js    Recurring transactions & subscriptions (schedules, due-date math, processing)
/js/ui.js          All DOM rendering (dashboard, list, drawer, modal, toasts, sheets, reports) + Chart.js management
/js/app.js         Bootstrap, routing, validation, event wiring
```

The JavaScript is intentionally modular. Each file attaches to a shared global
`window.ET` namespace and they load in dependency order
(`storage → transactions → expenses → parser → googleSheets → reports → budgets → recurring → ui → app`).
Chart.js (loaded from CDN before any script) provides the charting for the
Reports page. Classic scripts (not ES modules) are used so the app runs
correctly even when opened directly from the file system. All writes go through
the single `addTransaction()` function in `transactions.js` — the manual form,
the natural-language parser, and the Google Sheets layer all use the same save
path.

## Data model

```js
{
  id: "unique-id",
  type: "income" | "expense",
  title: "Monthly Salary",
  amount: 5000,
  currency: "AED",
  category: "Salary",
  vendor: "Company Name",
  date: "2026-08-25",
  notes: "",
  createdAt: 1690000000000,
  updatedAt: 1690000000000,
  syncStatus: "pending" | "synced" | "failed"
}
```

IDs are unique, amounts are stored as numbers, dates use `YYYY-MM-DD`, and
`syncStatus` tracks Google Sheets backup state (legacy records are treated as
`pending`).

The Google Sheets connection config (Web App URL, spreadsheet/sheet names,
last sync time) is stored separately in `localStorage` under
`et_sheets_config_v1`. Only non-secret configuration is ever stored — never
passwords, tokens, or API keys.

## Categories

**Expenses** — Food & Groceries · Transport · Shopping · Bills · Entertainment ·
Health · Education · Rent · Travel · Other

**Income** — Salary · Freelance · Business · Investment · Rental Income · Gift ·
Refund · Other Income

## Roadmap (not built yet)

Export / backup · notifications & polish · better Google Sheets reporting ·
PDF export · Settings · Authentication / cloud sync.

---

Default currency: **AED**.
