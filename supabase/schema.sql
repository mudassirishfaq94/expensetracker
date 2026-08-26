-- =========================================================================
-- Ledger — Supabase schema + Row Level Security
-- Run this in the Supabase SQL editor (or `supabase db push`).
--
--  * Every user-owned table carries user_id = auth.uid().
--  * Row Level Security is enabled and enforced with auth.uid().
--  * IDs are TEXT primary keys — the app already generates stable string
--    ids (transaction ids, "recurring_...", "g-..."), which keeps LocalStorage
--    migration idempotent (upsert by id) and preserves relationships.
-- =========================================================================

-- ------------------------------- PROFILES -------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);
drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own" on public.profiles
  for insert with check (auth.uid() = id);

-- Create a profile automatically when a user signs up (server side).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ----------------------------- TRANSACTIONS ------------------------------
create table if not exists public.transactions (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null default 'expense',
  title text not null default '',
  amount numeric not null default 0,
  currency text not null default 'AED',
  category text not null default '',
  vendor_source text not null default '',
  date date,
  notes text not null default '',
  recurring_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sync_status text not null default 'pending'
);

alter table public.transactions enable row level security;

drop policy if exists "transactions_select_own" on public.transactions;
create policy "transactions_select_own" on public.transactions
  for select using (auth.uid() = user_id);
drop policy if exists "transactions_insert_own" on public.transactions;
create policy "transactions_insert_own" on public.transactions
  for insert with check (auth.uid() = user_id);
drop policy if exists "transactions_update_own" on public.transactions;
create policy "transactions_update_own" on public.transactions
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "transactions_delete_own" on public.transactions;
create policy "transactions_delete_own" on public.transactions
  for delete using (auth.uid() = user_id);

-- -------------------------------- BUDGETS --------------------------------
create table if not exists public.budgets (
  user_id uuid primary key references auth.users(id) on delete cascade,
  monthly_budget numeric not null default 0,
  currency text not null default 'AED',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.budgets enable row level security;

drop policy if exists "budgets_select_own" on public.budgets;
create policy "budgets_select_own" on public.budgets
  for select using (auth.uid() = user_id);
drop policy if exists "budgets_insert_own" on public.budgets;
create policy "budgets_insert_own" on public.budgets
  for insert with check (auth.uid() = user_id);
drop policy if exists "budgets_update_own" on public.budgets;
create policy "budgets_update_own" on public.budgets
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "budgets_delete_own" on public.budgets;
create policy "budgets_delete_own" on public.budgets
  for delete using (auth.uid() = user_id);

-- ---------------------------- CATEGORY BUDGETS ---------------------------
create table if not exists public.category_budgets (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  category text not null,
  amount numeric not null default 0,
  currency text not null default 'AED',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, category)
);

alter table public.category_budgets enable row level security;

drop policy if exists "category_budgets_select_own" on public.category_budgets;
create policy "category_budgets_select_own" on public.category_budgets
  for select using (auth.uid() = user_id);
drop policy if exists "category_budgets_insert_own" on public.category_budgets;
create policy "category_budgets_insert_own" on public.category_budgets
  for insert with check (auth.uid() = user_id);
drop policy if exists "category_budgets_update_own" on public.category_budgets;
create policy "category_budgets_update_own" on public.category_budgets
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "category_budgets_delete_own" on public.category_budgets;
create policy "category_budgets_delete_own" on public.category_budgets
  for delete using (auth.uid() = user_id);

-- ---------------------------- FINANCIAL GOALS ----------------------------
create table if not exists public.financial_goals (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default '',
  target_amount numeric not null default 0,
  currency text not null default 'AED',
  target_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.financial_goals enable row level security;

drop policy if exists "financial_goals_select_own" on public.financial_goals;
create policy "financial_goals_select_own" on public.financial_goals
  for select using (auth.uid() = user_id);
drop policy if exists "financial_goals_insert_own" on public.financial_goals;
create policy "financial_goals_insert_own" on public.financial_goals
  for insert with check (auth.uid() = user_id);
drop policy if exists "financial_goals_update_own" on public.financial_goals;
create policy "financial_goals_update_own" on public.financial_goals
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "financial_goals_delete_own" on public.financial_goals;
create policy "financial_goals_delete_own" on public.financial_goals
  for delete using (auth.uid() = user_id);

-- -------------------------- GOAL CONTRIBUTIONS ---------------------------
create table if not exists public.goal_contributions (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  goal_id text not null references public.financial_goals(id) on delete cascade,
  amount numeric not null default 0,
  date date,
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.goal_contributions enable row level security;

drop policy if exists "goal_contributions_select_own" on public.goal_contributions;
create policy "goal_contributions_select_own" on public.goal_contributions
  for select using (auth.uid() = user_id);
drop policy if exists "goal_contributions_insert_own" on public.goal_contributions;
create policy "goal_contributions_insert_own" on public.goal_contributions
  for insert with check (auth.uid() = user_id);
drop policy if exists "goal_contributions_update_own" on public.goal_contributions;
create policy "goal_contributions_update_own" on public.goal_contributions
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "goal_contributions_delete_own" on public.goal_contributions;
create policy "goal_contributions_delete_own" on public.goal_contributions
  for delete using (auth.uid() = user_id);

-- ------------------------- RECURRING TRANSACTIONS ------------------------
create table if not exists public.recurring_transactions (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null default 'expense',
  title text not null default '',
  amount numeric not null default 0,
  currency text not null default 'AED',
  category text not null default '',
  vendor_source text not null default '',
  notes text not null default '',
  frequency text not null default 'monthly',
  start_date date,
  next_due_date date,
  last_generated_date date,
  status text not null default 'active',
  is_subscription boolean not null default false,
  needs_review boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.recurring_transactions enable row level security;

drop policy if exists "recurring_select_own" on public.recurring_transactions;
create policy "recurring_select_own" on public.recurring_transactions
  for select using (auth.uid() = user_id);
drop policy if exists "recurring_insert_own" on public.recurring_transactions;
create policy "recurring_insert_own" on public.recurring_transactions
  for insert with check (auth.uid() = user_id);
drop policy if exists "recurring_update_own" on public.recurring_transactions;
create policy "recurring_update_own" on public.recurring_transactions
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "recurring_delete_own" on public.recurring_transactions;
create policy "recurring_delete_own" on public.recurring_transactions
  for delete using (auth.uid() = user_id);

-- ------------------------------ USER SETTINGS ----------------------------
create table if not exists public.user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  currency text not null default 'AED',
  theme text not null default 'light',
  date_format text not null default 'dd mmm yyyy',
  timezone text not null default 'UTC',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_settings enable row level security;

drop policy if exists "user_settings_select_own" on public.user_settings;
create policy "user_settings_select_own" on public.user_settings
  for select using (auth.uid() = user_id);
drop policy if exists "user_settings_insert_own" on public.user_settings;
create policy "user_settings_insert_own" on public.user_settings
  for insert with check (auth.uid() = user_id);
drop policy if exists "user_settings_update_own" on public.user_settings;
create policy "user_settings_update_own" on public.user_settings
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- --------------------------- NOTIFICATIONS -----------------------------
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null default 'system',
  title text not null default '',
  message text not null default '',
  severity text not null default 'info',
  related_entity_type text,
  related_entity_id text,
  is_read boolean not null default false,
  dedupe_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.notifications enable row level security;

drop policy if exists "notifications_select_own" on public.notifications;
create policy "notifications_select_own" on public.notifications
  for select using (auth.uid() = user_id);
drop policy if exists "notifications_insert_own" on public.notifications;
create policy "notifications_insert_own" on public.notifications
  for insert with check (auth.uid() = user_id);
drop policy if exists "notifications_update_own" on public.notifications;
create policy "notifications_update_own" on public.notifications
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "notifications_delete_own" on public.notifications;
create policy "notifications_delete_own" on public.notifications
  for delete using (auth.uid() = user_id);

-- ------------------------------- INDEXES --------------------------------
create index if not exists transactions_user_id_idx on public.transactions (user_id);
create index if not exists category_budgets_user_id_idx on public.category_budgets (user_id);
create index if not exists financial_goals_user_id_idx on public.financial_goals (user_id);
create index if not exists goal_contributions_goal_id_idx on public.goal_contributions (goal_id);
create index if not exists goal_contributions_user_id_idx on public.goal_contributions (user_id);
create index if not exists recurring_user_id_idx on public.recurring_transactions (user_id);
create index if not exists notifications_user_id_idx on public.notifications (user_id);
create index if not exists notifications_user_read_idx on public.notifications (user_id, is_read);
create index if not exists notifications_user_created_idx on public.notifications (user_id, created_at desc);
create index if not exists notifications_dedupe_idx on public.notifications (user_id, dedupe_key);
