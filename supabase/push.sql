-- Rest-timer push. Run this once in your Supabase SQL editor, the same way
-- sync.sql was run. Safe to re-run: every statement is if-not-exists or a
-- drop-then-create.
--
-- WHY THIS EXISTS AT ALL. A rest timer that only lives in the page dies the
-- moment the phone locks or you switch apps - JavaScript stops running, and
-- setTimeout does not fire. Surviving that needs something outside the phone
-- to send a push at the right moment, which is these two tables plus the
-- send-timer-push Edge Function.

-- 1. SUBSCRIPTIONS. One row per device that opted in. The endpoint is the
--    push service's own URL for that device, and it is naturally unique, so it
--    is the key: re-subscribing the same device updates rather than piling up
--    a second row that would send every notification twice.
create table if not exists push_subscriptions (
  endpoint   text primary key,
  user_id    uuid not null references auth.users on delete cascade,
  p256dh     text not null,
  auth       text not null,
  user_agent text,
  created_at timestamptz not null default now()
);

alter table push_subscriptions enable row level security;

drop policy if exists "own subscriptions" on push_subscriptions;
create policy "own subscriptions" on push_subscriptions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- RLS never even evaluates without the grant. Same law as sync.sql.
grant select, insert, update, delete on push_subscriptions to authenticated;

create index if not exists push_subs_user on push_subscriptions (user_id);


-- 2. TIMERS. One row per rest timer started. `fired` is what stops a
--    notification being sent twice: the function flips it in the same pass it
--    sends, and only ever selects rows where it is false.
create table if not exists rest_timers (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users on delete cascade,
  fire_at    timestamptz not null,
  label      text,
  fired      boolean not null default false,
  created_at timestamptz not null default now()
);

alter table rest_timers enable row level security;

drop policy if exists "own timers" on rest_timers;
create policy "own timers" on rest_timers
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

grant select, insert, update, delete on rest_timers to authenticated;

-- The function's only query: unfired rows whose time has come. Partial index,
-- because a fired row is never read again and there will be far more of those
-- than pending ones.
create index if not exists rest_timers_due
  on rest_timers (fire_at) where fired = false;


-- 3. HOUSEKEEPING. A fired timer has no further use, and without this the
--    table grows forever. Keeps a day so a missed send can still be seen.
-- Deletes fired rows AND rows that were never sent and never will be. The
-- second half matters: the function ignores anything more than an hour past
-- due (see STALE_AFTER_MS), so without this, a spell where sending was broken
-- leaves unsendable rows sitting in the table for ever.
create or replace function prune_rest_timers() returns void
language sql security definer set search_path = public as $$
  delete from rest_timers where fire_at < now() - interval '1 day';
$$;


-- ---------------------------------------------------------------------------
-- 4. THE SCHEDULE. Run these two AFTER deploying the send-timer-push function,
--    or the first tick calls a URL that does not exist yet.
--
--    Replace <PROJECT-REF> with zqqqczmqkacigihzdmbs and <SERVICE-ROLE-KEY>
--    with the service_role key from Settings -> API. That key bypasses RLS on
--    purpose: cron is not a signed-in user, and it has to read timers across
--    every device that subscribed.
--
--    15 seconds is deliberate. pg_cron takes sub-minute intervals, and a rest
--    timer that fires up to a minute late is useless. Up to ~15s late is not.
-- ---------------------------------------------------------------------------

-- create extension if not exists pg_cron;
-- create extension if not exists pg_net;
--
-- select cron.schedule(
--   'send-timer-push',
--   '15 seconds',
--   $$
--   select net.http_post(
--     url     := 'https://<PROJECT-REF>.supabase.co/functions/v1/send-timer-push',
--     headers := jsonb_build_object(
--       'Content-Type',  'application/json',
--       'Authorization', 'Bearer <SERVICE-ROLE-KEY>'
--     ),
--     body    := '{}'::jsonb
--   );
--   $$
-- );
--
-- select cron.schedule('prune-rest-timers', '0 4 * * *', $$ select prune_rest_timers(); $$);

-- To stop it later:
--   select cron.unschedule('send-timer-push');
--   select cron.unschedule('prune-rest-timers');
--
-- To see whether it is running:
--   select * from cron.job;
--   select * from cron.job_run_details order by start_time desc limit 20;
