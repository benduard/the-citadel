-- The screen time inlet. Run this once in your Supabase SQL editor, the same
-- way sync.sql, push.sql, wearable.sql and scale.sql were run. Safe to re-run:
-- create-or-replace throughout.
--
--
-- ── READ THIS BEFORE CHANGING ANYTHING HERE ───────────────────────────────────
--
-- WHAT APPLE ACTUALLY ALLOWS. There is NO public API for Screen Time usage.
-- The DeviceActivity and FamilyControls frameworks are native only, require an
-- entitlement from Apple, and render their numbers inside a privacy extension
-- that the containing app cannot read and that has no network access at all.
-- The Shortcuts app has no action for it either. So no web page, no Shortcut,
-- no server and no key can ask an iPhone what its screen time was. That is a
-- deliberate Apple design decision, not a gap waiting for a clever workaround.
--
-- Everything below therefore takes data from something that ALREADY HAS IT and
-- pushes it in. Two writers, and they are deliberately different things:
--
--   1. THE MAC EXPORT (screentime_auto_upsert). The only fully automatic path
--      to Apple's own figures. With Screen Time "Share Across Devices" on, the
--      iPhone's usage rows sync into the Mac's local knowledgeC.db, and
--      tools/screentime-export.sh reads them and calls this. Apple syncs that
--      on its own schedule: expect minutes to about an hour of lag. It is NOT
--      live, and nothing here pretends it is.
--
--   2. THE APP AUTOMATIONS (screentime_app_event). iPhone Shortcuts personal
--      automations on "App is Opened" and "App is Closed", one pair per app you
--      care about. This IS near real time, and it is an approximation: it only
--      ever sees apps you set an automation for. It is a floor on the day,
--      never the day, and the tile labels it that way on screen.
--
-- The board itself writes NEITHER of these. A sealed tile never fetches and
-- never holds a key, so the phone and the Mac hold the credential and the repo
-- holds none.
--
--
-- ── WHERE IT LANDS, AND WHY NOT IN THE TILE'S OWN SLOT ────────────────────────
--
-- The Screen time tile owns slot 'screentime'. Everything here writes to
-- 'screentime:auto', a second slot beside it, and NEVER touches the first.
--
-- Same law recovery:auto and body:auto already follow, for the same reason: the
-- tile saves its slot wholesale on every edit, so an automation writing the
-- same slot would race a person typing and silently destroy a day they entered
-- by hand. Two slots means the automation can never overwrite you.
--
-- Shape of 'screentime:auto':
--
--   {
--     "days": { "YYYY-MM-DD": {
--        "min":      420,                 -- authoritative total, from the Mac
--        "pickups":  87,
--        "apps":     { "Safari": 61 },    -- authoritative per-app, from the Mac
--        "live":     38,                  -- accumulated from open/close events
--        "liveApps": { "Safari": 12 },
--        "src":      "mac-knowledgec",
--        "at":       "2026-09-07T18:00:00Z"
--     } },
--     "open": { "Safari": { "at": "...", "date": "YYYY-MM-DD" } }
--   }
--
-- min AND live ARE NEVER ADDED TOGETHER, here or in the tile. They are two
-- different measurements of the same hours, not two parts of one, so summing
-- them would double the day. The tile prefers min where it exists because it is
-- Apple's own count, falls back to live, and always says which is on screen.
--
-- The two writers touch DISJOINT FIELDS on purpose. screentime_auto_upsert
-- owns min / pickups / apps. screentime_app_event owns live / liveApps / open.
-- Neither can destroy the other's work, so the Mac catching up at 18:00 does
-- not wipe the afternoon the automations counted, and vice versa.
--
-- SECURITY INVOKER (the default, stated outright) is the point: each function
-- runs as whoever called it, auth.uid() is that person, and the row level
-- policy on vault_slots applies exactly as it does to the board itself. There
-- is no service-role key anywhere here and nothing that can reach another
-- account.


-- ── 1. THE MAC EXPORT: one whole day, recounted ───────────────────────────────
--
-- REPLACES min / pickups / apps for that date rather than merging them, and
-- that is the correct behaviour for this writer specifically: the export is a
-- full recomputation of the day from knowledgeC.db, so merging would leave
-- stale per-app rows behind for ever - an app closed for good in the morning
-- would keep its minutes on the list until the end of time.
--
-- It never touches live / liveApps / open. Those belong to the other writer.
--
-- A NULL field is left ABSENT, never written as zero. Same law as the tile: a
-- day with a total and no pickup count is a real day, and a zero is a lie.
create or replace function screentime_auto_upsert(
  p_date    date,
  p_minutes numeric default null,
  p_pickups numeric default null,
  p_apps    jsonb   default null,
  p_src     text    default 'mac-knowledgec'
) returns jsonb
language plpgsql
security invoker
as $$
declare
  uid      uuid  := auth.uid();
  day      jsonb := '{}'::jsonb;
  cur      jsonb;
  existing jsonb;
  keep     jsonb := '{}'::jsonb;
  k        text;
begin
  if uid is null then
    raise exception 'not signed in';
  end if;

  if p_date is null then
    raise exception 'a day needs a date';
  end if;

  -- A date in the future is a clock problem, not a day on a phone. Refuse it
  -- rather than file a day that has not happened. One day of slack, because a
  -- Mac and a server can disagree about midnight across a timezone.
  if p_date > (current_date + 1) then
    raise exception 'that day has not happened yet: %', p_date;
  end if;

  -- 1440 minutes is a whole day. Anything past it is a broken query, not a
  -- person, and a silently accepted 3000 would poison every average built on
  -- it afterwards.
  if p_minutes is not null and (p_minutes < 0 or p_minutes > 1440) then
    raise exception 'screen minutes out of range for one day: %', p_minutes;
  end if;

  if p_pickups is not null and p_pickups < 0 then
    raise exception 'pickups cannot be negative: %', p_pickups;
  end if;

  if p_apps is not null and jsonb_typeof(p_apps) <> 'object' then
    raise exception 'apps must be a json object of name -> minutes';
  end if;

  if p_minutes is not null then day := day || jsonb_build_object('min',     round(p_minutes)); end if;
  if p_pickups is not null then day := day || jsonb_build_object('pickups', round(p_pickups)); end if;
  if p_apps    is not null then day := day || jsonb_build_object('apps',    p_apps);           end if;

  -- Nothing arrived. Say so plainly and write nothing, so an export that read
  -- an empty database reports back as empty instead of looking like it worked.
  -- A silent no-op is how a dead automation hides for months.
  if day = '{}'::jsonb then
    return jsonb_build_object('ok', false, 'date', p_date, 'reason', 'nothing in that request');
  end if;

  day := day || jsonb_build_object('src', coalesce(p_src, 'unknown'), 'at', now());

  select data into cur from vault_slots where user_id = uid and slot = 'screentime:auto';
  cur := coalesce(cur, '{}'::jsonb);
  if not (cur ? 'days') then
    cur := cur || '{"days":{}}'::jsonb;
  end if;

  -- Carry the OTHER writer's fields through untouched, and drop this writer's
  -- old ones. This is the "replace mine, keep theirs" rule spelled out.
  existing := coalesce(cur #> array['days', p_date::text], '{}'::jsonb);
  for k in select jsonb_object_keys(existing) loop
    if k in ('live', 'liveApps') then
      keep := keep || jsonb_build_object(k, existing -> k);
    end if;
  end loop;

  cur := jsonb_set(cur, array['days', p_date::text], keep || day, true);
  cur := screentime_prune(cur);

  insert into vault_slots (user_id, slot, data, updated_at)
  values (uid, 'screentime:auto', cur, now())
  on conflict (user_id, slot) do update
    set data = excluded.data, updated_at = now();

  return jsonb_build_object('ok', true, 'date', p_date, 'wrote', keep || day);
end;
$$;


-- ── 2. THE APP AUTOMATIONS: one app opening or closing ────────────────────────
--
-- Called twice per app session by two iPhone Shortcuts personal automations:
-- "When Safari is opened" -> event 'open', "When Safari is closed" -> 'close'.
--
-- WHY PAIRING HAPPENS HERE AND NOT ON THE PHONE. A Shortcut has nowhere durable
-- to keep "Safari opened at 17:42" between two separate automations, and iOS
-- can kill one mid-run. Server side, an unpaired open is just a row that sits
-- there until its close arrives or the guard below throws it away.
--
-- p_date IS REQUIRED AND IS THE PHONE'S LOCAL DATE. The server runs in UTC and
-- has no idea what day it is where the phone is. A Shortcut produces it in one
-- step: Format Date, Custom, yyyy-MM-dd. Guessing it here would silently file
-- an evening's usage under tomorrow for anyone east of Greenwich.
create or replace function screentime_app_event(
  p_app   text,
  p_event text,
  p_date  date,
  p_at    timestamptz default now()
) returns jsonb
language plpgsql
security invoker
as $$
declare
  uid      uuid := auth.uid();
  cur      jsonb;
  app      text := nullif(btrim(coalesce(p_app, '')), '');
  ev       text := lower(btrim(coalesce(p_event, '')));
  at_ts    timestamptz := coalesce(p_at, now());
  started  timestamptz;
  onday    date;
  mins     numeric;
  existing jsonb;
  liveApps jsonb;
  -- A session longer than this is a close that never fired: the phone
  -- rebooted, the automation was killed, iOS simply did not run it. Twelve
  -- hours of continuous Safari is not a thing that happens, and accepting it
  -- would put a 700 minute day on the board off one missed event. Dropped, and
  -- said out loud in the return, rather than guessed at.
  max_session_min constant numeric := 720;
begin
  if uid is null then
    raise exception 'not signed in';
  end if;

  if app is null then
    raise exception 'an event needs an app name';
  end if;

  if ev not in ('open', 'close') then
    raise exception 'event must be open or close, got %', coalesce(p_event, 'null');
  end if;

  if p_date is null then
    raise exception 'an event needs the phone local date, formatted yyyy-MM-dd';
  end if;

  if p_date > (current_date + 1) then
    raise exception 'that day has not happened yet: %', p_date;
  end if;

  select data into cur from vault_slots where user_id = uid and slot = 'screentime:auto';
  cur := coalesce(cur, '{}'::jsonb);
  if not (cur ? 'days') then cur := cur || '{"days":{}}'::jsonb; end if;
  if not (cur ? 'open') then cur := cur || '{"open":{}}'::jsonb; end if;

  -- ── OPEN. Record when, and the day the phone thinks it is.
  --
  -- A second open with no close in between REPLACES the first rather than
  -- stacking. Two opens mean the close was missed, and the later one is the
  -- session actually running now. Keeping the older one would bill the whole
  -- gap to this app.
  if ev = 'open' then
    cur := jsonb_set(cur, array['open', app],
      jsonb_build_object('at', at_ts, 'date', p_date), true);
    -- Pruned on the way in as well as on the way out, because an app whose
    -- close never fires leaves its open sitting there for ever otherwise, and
    -- the tile reads that list to say what is running right now.
    cur := screentime_prune(cur);

    insert into vault_slots (user_id, slot, data, updated_at)
    values (uid, 'screentime:auto', cur, now())
    on conflict (user_id, slot) do update
      set data = excluded.data, updated_at = now();

    return jsonb_build_object('ok', true, 'app', app, 'event', 'open', 'at', at_ts);
  end if;

  -- ── CLOSE. Pair it with the open, or say plainly that there was not one.
  started := (cur #>> array['open', app, 'at'])::timestamptz;
  if started is null then
    -- Not an error. The first close after this was set up genuinely has no
    -- open, and so does a close that arrives after the guard below binned its
    -- session. Nothing is written and the Shortcut is told why.
    return jsonb_build_object('ok', false, 'app', app, 'event', 'close',
                              'reason', 'no open session for that app');
  end if;

  -- The day the session STARTED, not the day it ended. An app opened at 23:50
  -- and closed at 00:05 belongs to the evening you were using it.
  onday := coalesce((cur #>> array['open', app, 'date'])::date, p_date);
  mins  := extract(epoch from (at_ts - started)) / 60.0;

  -- The open is consumed either way, so a bad pairing cannot poison the next
  -- session too.
  cur := cur #- array['open', app];

  if mins <= 0 then
    insert into vault_slots (user_id, slot, data, updated_at)
    values (uid, 'screentime:auto', cur, now())
    on conflict (user_id, slot) do update
      set data = excluded.data, updated_at = now();
    return jsonb_build_object('ok', false, 'app', app, 'event', 'close',
                              'reason', 'close arrived before its open', 'minutes', mins);
  end if;

  if mins > max_session_min then
    insert into vault_slots (user_id, slot, data, updated_at)
    values (uid, 'screentime:auto', cur, now())
    on conflict (user_id, slot) do update
      set data = excluded.data, updated_at = now();
    return jsonb_build_object('ok', false, 'app', app, 'event', 'close',
                              'reason', 'session longer than 12h, treated as a missed close',
                              'minutes', round(mins));
  end if;

  existing := coalesce(cur #> array['days', onday::text], '{}'::jsonb);
  liveApps := coalesce(existing -> 'liveApps', '{}'::jsonb);

  liveApps := jsonb_set(liveApps, array[app],
    to_jsonb(round(coalesce((liveApps ->> app)::numeric, 0) + mins)), true);

  existing := existing
    || jsonb_build_object('live', round(coalesce((existing ->> 'live')::numeric, 0) + mins))
    || jsonb_build_object('liveApps', liveApps)
    || jsonb_build_object('at', now());

  -- src is only set when this writer is the ONLY one for the day. The Mac's
  -- src must survive, because the tile shows it and "from Apple Screen Time"
  -- turning into "from app automations" would be a lie about a number that
  -- did not change.
  if not (existing ? 'min') then
    existing := existing || jsonb_build_object('src', 'app-automation');
  end if;

  cur := jsonb_set(cur, array['days', onday::text], existing, true);
  cur := screentime_prune(cur);

  insert into vault_slots (user_id, slot, data, updated_at)
  values (uid, 'screentime:auto', cur, now())
  on conflict (user_id, slot) do update
    set data = excluded.data, updated_at = now();

  return jsonb_build_object('ok', true, 'app', app, 'event', 'close',
                            'date', onday, 'minutes', round(mins));
end;
$$;


-- ── 3. PRUNING, so one jsonb column does not grow for ever ────────────────────
--
-- Keeps the last 120 days of detail and drops anything older, plus any open
-- session left dangling for more than a day by an automation that never fired
-- its close.
--
-- WHAT THIS ACTUALLY LOSES, stated plainly rather than buried: the per-app
-- breakdown for days older than four months. The daily TOTAL is not lost - the
-- tile reports it into the ledger, which keeps one row per key per day for
-- ever and is the thing a local model reads later. This slot is a working
-- surface for the last few months, not the archive.
--
-- Declared before the two functions above call it? No: PL/pgSQL resolves
-- function names at RUN time, not at creation, so the order in this file does
-- not matter. It only has to exist before the first real call.
-- STABLE, NEVER IMMUTABLE, and the difference bites here. This reads
-- current_date and now(), so its answer changes from one day to the next.
-- Marking it immutable tells the planner it is safe to fold and cache, which
-- is how a cutoff silently freezes on the day it was first evaluated.
create or replace function screentime_prune(cur jsonb)
returns jsonb
language plpgsql
stable
as $$
declare
  out_days jsonb := '{}'::jsonb;
  out_open jsonb := '{}'::jsonb;
  k        text;
  cutoff   date := current_date - 120;
begin
  if cur is null then return '{"days":{},"open":{}}'::jsonb; end if;

  for k in select jsonb_object_keys(coalesce(cur -> 'days', '{}'::jsonb)) loop
    -- A key that is not a date is not something this file wrote. Drop it
    -- rather than crash on the cast.
    begin
      if k::date >= cutoff then
        out_days := out_days || jsonb_build_object(k, cur #> array['days', k]);
      end if;
    exception when others then
      null;
    end;
  end loop;

  for k in select jsonb_object_keys(coalesce(cur -> 'open', '{}'::jsonb)) loop
    begin
      if (cur #>> array['open', k, 'at'])::timestamptz > (now() - interval '1 day') then
        out_open := out_open || jsonb_build_object(k, cur #> array['open', k]);
      end if;
    exception when others then
      null;
    end;
  end loop;

  return jsonb_build_object('days', out_days, 'open', out_open);
end;
$$;


-- EXECUTE never even evaluates without the grant, the same way RLS does not
-- without its grant. Always grant.
grant execute on function screentime_auto_upsert(date, numeric, numeric, jsonb, text) to authenticated;
grant execute on function screentime_app_event(text, text, date, timestamptz) to authenticated;
grant execute on function screentime_prune(jsonb) to authenticated;


-- ── CHECKING IT WORKS ─────────────────────────────────────────────────────────
--
-- The SQL editor runs as an admin, not as you, so auth.uid() is null there and
-- calling these by hand will correctly say 'not signed in'. That is the
-- function proving it is scoped, not a fault. The real test is the export
-- script or the Shortcut, either of which carries your session.
--
-- To read back what has landed, once something has:
--
--   select jsonb_pretty(data), updated_at
--   from vault_slots
--   where slot = 'screentime:auto';
--
--
-- ── THE LEDGER, AND THE SECOND BRAIN ──────────────────────────────────────────
--
-- Nothing above writes the ledger. The TILE does, through Vitality.report(),
-- one row per day under key 'screen_minutes', value in minutes. That is on
-- purpose: the inlet's job is to deliver a reading, and the tile's job is to
-- decide which reading is the honest one for that day - it will not file a
-- partial live count as a whole day.
--
-- That one row is the whole point of the one-shape ledger, and it is what a
-- local model reads later. No extra pipe is needed and none should be built:
--
--   select date, key, value
--   from ledger
--   where key in ('screen_minutes', 'sleep_hours', 'body_weight')
--     and date >= current_date - 30
--   order by date, key;
--
-- One query, gym and sleep and hours on a phone, side by side, in one table.
-- That is the trick the vault was built for. Point whatever runs locally at
-- this table with your own anon session; do not put a model's key anywhere in
-- the board, and do not give the board a service-role key to make this easier.
