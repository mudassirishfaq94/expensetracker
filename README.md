# Ledger — Expense Tracker (Part 1: Core Foundation)

A calm, local-first expense tracker. This is **Part 1** of a larger project: a
fully working frontend foundation that stores expenses in the browser via
`localStorage`. No backend, no accounts, no external services — your data never
leaves the browser.

> Later phases will add natural-language entry ("I bought sugar from Carrefour
> for 12 AED"), Google Sheets sync, reports, and settings. None of that is built
> yet — this phase is deliberately scoped to a solid, expandable core.

## Features

- **Dashboard** with live totals: spent this month, today's spending, total
  transactions, largest expense, plus a spending-by-category breakdown and a
  recent-activity feed. Everything recomputes automatically on any change.
- **Add / edit expenses** through a slide-in form with inline validation
  (title, amount > 0, category, and date are required).
- **Expense list** as a sortable table on desktop and cards on mobile, always
  newest-first, with per-row edit and delete.
- **Delete** with a confirmation dialog.
- **Search & filter** instantly by title/store, category, and month.
- **Sample data** loadable on demand (never auto-seeded, so once you delete it,
  it stays gone).
- **Persistence** — refresh the page and everything is still there.

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
/index.html        Markup: sidebar, dashboard, expenses view, drawer, modal
/css/style.css     Full design system (tokens, components, responsive)
/js/storage.js     localStorage layer, id generation, sample data
/js/expenses.js    CRUD orchestration, filtering, sorting, statistics
/js/ui.js          All DOM rendering (dashboard, list, drawer, modal, toasts)
/js/app.js         Bootstrap, routing, validation, event wiring
```

The JavaScript is intentionally modular. Each file attaches to a shared global
`window.ET` namespace and they load in dependency order
(`storage → expenses → ui → app`). Classic scripts (not ES modules) are used so
the app runs correctly even when opened directly from the file system.

## Data model

```js
{
  id: "unique-id",
  title: "Sugar",
  amount: 12,
  currency: "AED",
  category: "Food & Groceries",
  vendor: "Carrefour",
  date: "2026-08-25",
  notes: "",
  createdAt: 1690000000000,
  updatedAt: 1690000000000
}
```

## Categories

Food & Groceries · Transport · Shopping · Bills · Entertainment · Health ·
Education · Other

## Roadmap (not in Part 1)

Natural-language expense entry · Google Sheets integration · Reports & charts ·
Settings · Authentication / cloud sync.

---

Default currency: **AED**.
