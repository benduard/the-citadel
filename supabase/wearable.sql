-- The wearable inlet. Run this once in your Supabase SQL editor, the same way
-- sync.sql and push.sql were run. Safe to re-run: create-or-replace throughout.
--
-- WHY THIS EXISTS AT ALL. A sealed tile never fetches and never holds a key, so
-- a watch or a ring can never reach the Recovery tile by itself. The honest
-- path is the other direction: something that ALREADY has the data pushes it
-- in. On this board that is an iPhone Shortcut reading Apple Health once a
-- morning and calling the function below. The phone holds the credential, the
-- repo holds no key, and the tile stays sealed.
--
-- Apple Health is the interface on purpose, not FitCloudPro. Any device that
-- writes into Health feeds this: a cheap ring, an Apple Watch, a band bought
-- next year. Nothing here is tied to one brand.


-- ── WHERE IT LANDS, AND WHY NOT IN THE TILE'S OWN SLOT ────────────────────────
--
-- The Recovery tile owns slot 'recovery'. This writes to 'recovery:auto', a
-- second slot beside it, and NEVER touches the first.
--
-- That separation is the whole safety of this feature. The tile saves its slot
-- wholesale on every edit, so an automation writing into the same slot would
-- race a person typing and silently destroy a morning they entered by hand.
-- Two slots means the watch can never overwrite you. It also means the tile can
-- show both readings side by side and let you accept one, which is the
-- behaviour that was chosen for a disagreement.
--
-- Shape of 'recovery:auto', deliberately the SAME shape the tile already uses
-- for its own days, so the tile needs no second mental model:
--
--   { days: { "YYYY-MM-DD": {
--       sleepH,  -- hours slept, decimal
--       hrv,     -- ms
--       rhr,     -- resting heart rate, bpm
--       resp,    -- breaths/min
--       src,     -- where it came from, e.g. 'apple-health'
--       at       -- when it was written, so a stale feed is visible as stale
--   } } }
--
-- THE DATE IS THE MORNING, not the evening the sleep started. A night from
-- 23:00 on the 4th to 07:00 on the 5th is the 5th, because that is the morning
-- you read the number and the day the tile files it under.


-- ── THE WRITER ────────────────────────────────────────────────────────────────
--
-- One call writes one morning. Why a function instead of letting the Shortcut
-- POST the table directly:
--
--   1. A direct write sends the WHOLE slot, so the Shortcut would have to read
--      it, merge, and write it back. Any hiccup between those steps loses
--      every morning it already held. This merges server-side, one day at a
--      time, so the worst case is one morning missing rather than all of them.
--   2. A partial payload cannot do damage. Send sleep alone on Monday and HRV
--      alone on Tuesday and both survive, because fields merge into the day
--      rather than replacing it.
--   3. The Shortcut stays trivial: one flat request, no JSON surgery in an
--      app where JSON surgery is genuinely painful.
--
-- SECURITY INVOKER (the default, stated outright) is the point: the function
-- runs as whoever called it, auth.uid() is that person, and the row-level
-- policy on vault_slots applies exactly as it does to the board itself. There
-- is no service-role key here and nothing that can reach another account.
--
-- A NULL field is left ABSENT, never written as zero. Same law as the tile: a
-- morning with sleep and no HRV is a real morning, and a zero HRV is a lie
-- that would poison the fourteen-day baseline the readiness band is built on.
create or replace function recovery_auto_upsert(
  p_date  date,
  p_sleep numeric default null,
  p_hrv   numeric default null,
  p_rhr   numeric default null,
  p_resp  numeric default null,
  p_src   text    default 'apple-health'
) returns jsonb
language plpgsql
security invoker
as $$
declare
  uid      uuid := auth.uid();
  day      jsonb := '{}'::jsonb;
  cur      jsonb;
  existing jsonb;
begin
  if uid is null then
    raise exception 'not signed in';
  end if;

  if p_date is null then
    raise exception 'a morning needs a date';
  end if;

  -- A date in the future is a clock problem, not a night's sleep. Refuse it
  -- rather than file a morning that has not happened.
  if p_date > (current_date + 1) then
    raise exception 'that morning has not happened yet: %', p_date;
  end if;

  -- Absent, never zero. Each field is only carried if it actually arrived.
  if p_sleep is not null then day := day || jsonb_build_object('sleepH', p_sleep); end if;
  if p_hrv   is not null then day := day || jsonb_build_object('hrv',    p_hrv);   end if;
  if p_rhr   is not null then day := day || jsonb_build_object('rhr',    p_rhr);   end if;
  if p_resp  is not null then day := day || jsonb_build_object('resp',   p_resp);  end if;

  -- Nothing arrived. Say so plainly and write nothing, so a Shortcut that read
  -- an empty Health category reports back as empty instead of looking like it
  -- worked. A silent no-op is how a dead automation hides for months.
  if day = '{}'::jsonb then
    return jsonb_build_object('ok', false, 'date', p_date, 'reason', 'no readings in that request');
  end if;

  day := day || jsonb_build_object('src', coalesce(p_src, 'unknown'), 'at', now());

  select data into cur from vault_slots where user_id = uid and slot = 'recovery:auto';
  cur := coalesce(cur, '{}'::jsonb);
  if not (cur ? 'days') then
    cur := cur || '{"days":{}}'::jsonb;
  end if;

  -- Merge into whatever that morning already held, so a second run of the day
  -- adds a field rather than replacing the morning.
  existing := coalesce(cur #> array['days', p_date::text], '{}'::jsonb);
  cur := jsonb_set(cur, array['days', p_date::text], existing || day, true);

  insert into vault_slots (user_id, slot, data, updated_at)
  values (uid, 'recovery:auto', cur, now())
  on conflict (user_id, slot) do update
    set data = excluded.data, updated_at = now();

  return jsonb_build_object('ok', true, 'date', p_date, 'wrote', existing || day);
end;
$$;

-- EXECUTE never even evaluates without the grant, the same way RLS does not
-- without its grant. Always grant.
grant execute on function recovery_auto_upsert(date, numeric, numeric, numeric, numeric, text) to authenticated;


-- ── CHECKING IT WORKS ─────────────────────────────────────────────────────────
--
-- The SQL editor runs as an admin, not as you, so auth.uid() is null there and
-- calling this by hand will correctly say 'not signed in'. That is the function
-- proving it is scoped, not a fault. The real test is the Shortcut, which
-- carries your session.
--
-- To read back what has landed, once something has:
--
--   select slot, jsonb_pretty(data), updated_at
--   from vault_slots
--   where slot = 'recovery:auto';
