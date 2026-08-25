# Ledger — Personal Finance Tracker

A calm, local-first income and expense tracker. Tracks both income and expense
transactions entirely in the browser via `localStorage`. No backend, no
accounts, no external services — your data never leaves the browser.

> Completed phases:
> **Part 1** — expense-only core foundation (dashboard, CRUD, filters).
> **Part 2** — income + expense transaction system with a financial summary.
> **Part 3** — natural-language transaction input (smart entry).
> The next phase (Part 4) will add Google Sheets integration and automatic
> synchronization; reports and settings are planned later.

## Features

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
/index.html        Markup: sidebar, dashboard (with smart input), transactions view, drawer, modal
/css/style.css     Full design system (tokens, components, responsive)
/js/storage.js     localStorage layer, migration, id generation, sample data
/js/transactions.js  Domain logic: CRUD, filtering, sorting, statistics
/js/expenses.js    Compatibility shim (aliases ET.expenses to ET.transactions)
/js/parser.js      Rule-based natural-language parser (smart entry)
/js/ui.js          All DOM rendering (dashboard, list, drawer, modal, toasts)
/js/app.js         Bootstrap, routing, validation, event wiring
```

The JavaScript is intentionally modular. Each file attaches to a shared global
`window.ET` namespace and they load in dependency order
(`storage → transactions → expenses → parser → ui → app`). Classic scripts (not
ES modules) are used so the app runs correctly even when opened directly from
the file system. All writes go through the single `addTransaction()` function
in `transactions.js` — the manual form and the natural-language parser both use
it, and a future AI parser can reuse the same central save path.

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
  updatedAt: 1690000000000
}
```

IDs are unique, amounts are stored as numbers, and dates use `YYYY-MM-DD`.

## Categories

**Expenses** — Food & Groceries · Transport · Shopping · Bills · Entertainment ·
Health · Education · Rent · Travel · Other

**Income** — Salary · Freelance · Business · Investment · Rental Income · Gift ·
Refund · Other Income

## Roadmap (not built yet)

Part 4: Google Sheets integration & automatic synchronization · Reports &
charts · Settings · Authentication / cloud sync.

---

Default currency: **AED**.
