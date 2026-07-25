-- The vault. Run this once in your Supabase SQL editor.
-- Two tables. Both scoped to you and only you.

-- 1. SLOTS. What each tile saves and loads. One row per tile.
create table if not exists vault_slots (
  user_id    uuid not null references auth.users on delete cascade,
  slot       text not null,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, slot)
);

alter table vault_slots enable row level security;

drop policy if exists "own slots" on vault_slots;
create policy "own slots" on vault_slots
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- RLS never even evaluates without the grant. Always grant.
grant select, insert, update, delete on vault_slots to authenticated;

-- 2. LEDGER. Every log, one shape, so it reads across everything at once.
--    key, value, date, source is the core shape. label / kind / goal_direction
--    / tile carry what a tile's report() already says about its number, so the
--    remote ledger holds exactly what the local one does.
create table if not exists ledger (
  id      bigint generated always as identity primary key,
  user_id uuid not null references auth.users on delete cascade,
  key     text not null,
  value   numeric,
  text    text,
  date    date not null,
  source  text not null default 'manual' check (source in ('manual','auto')),
  logged  timestamptz not null default now()
);

-- Safe to re-run. A board created before these columns existed gains them here
-- without touching a row it already holds.
alter table ledger add column if not exists label          text;
alter table ledger add column if not exists kind           text;
alter table ledger add column if not exists goal_direction text;
alter table ledger add column if not exists tile           text;

create index if not exists ledger_user_key_date on ledger (user_id, key, date desc);

-- One row per key per day: re-reporting a day replaces it, never stacks a
-- second row. The client relies on this being true.
create unique index if not exists ledger_user_key_date_unique on ledger (user_id, key, date);

alter table ledger enable row level security;

drop policy if exists "own ledger" on ledger;
create policy "own ledger" on ledger
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

grant select, insert, update, delete on ledger to authenticated;
