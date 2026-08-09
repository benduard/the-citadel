-- The scale inlet. Run this once in your Supabase SQL editor, the same way
-- sync.sql, push.sql and wearable.sql were run. Safe to re-run: create-or-
-- replace throughout.
--
-- WHY THIS EXISTS AT ALL. A sealed tile never fetches and never holds a key, so
-- the scale can never reach the Body tile by itself. Same answer as the
-- wearable (supabase/wearable.sql): the phone already has the number, so the
-- phone pushes it. An iPhone Shortcut reads the morning's weight out of Apple
-- Health once a day and calls the function below. The phone holds the
-- credential, the repo holds no key, and the tile stays sealed.
--
-- APPLE HEALTH IS THE INTERFACE, NOT VESYNC, and it is the same decision the
-- wearable inlet made for the same reason. The VeSync app writes weight into
-- Apple Health (Etekcity's scales list Apple Health, Google Fit, Fitbit,
-- MyFitnessPal and Samsung Health as their sync targets). Reading Health rather
-- than VeSync means a scale bought next year, from anyone, feeds this unchanged
-- and nothing here is tied to one brand. There is also no supported VeSync API
-- to read: the integrations that exist are unofficial reverse engineerings of a
-- phone app's private endpoints, which is not something to hang a morning on.


-- ── WHERE IT LANDS, AND WHY NOT IN THE TILE'S OWN SLOT ────────────────────────
--
-- The Body tile owns slot 'body'. This writes to 'body:auto', a second slot
-- beside it, and NEVER touches the first.
--
-- Exactly the separation recovery:auto was built with, for exactly the same
-- reason. The tile saves its slot wholesale on every edit, so an automation
-- writing into the same slot would race a person typing and silently destroy a
-- weight they entered by hand. Two slots means the scale can never overwrite
-- him. It also means the tile can show a typed weight and a scale weight for
-- the same morning side by side, which is what a disagreement deserves.
--
-- Shape of 'body:auto':
--
--   { days: { "YYYY-MM-DD": {
--       kg,    -- weight in KILOGRAMS, always. see below.
--       fat,   -- body fat percent, if the scale measured one. optional.
--       src,   -- where it came from, e.g. 'apple-health'
--       at     -- when it was written, so a stale feed is visible as stale
--   } } }
--
-- KILOGRAMS, ALWAYS, whatever the tile happens to be displaying. That is the
-- Body tile's own law and this does not get to be the exception: a column
-- holding two units with no way to tell them apart cannot be read back. The
-- Shortcut converts once, on the phone, before it sends. A scale set to pounds
-- with a Shortcut that forgets to convert is the one way to poison this, which
-- is why the range check below is deliberately tight enough to catch it.
--
-- THE DATE IS THE MORNING THE READING WAS TAKEN, not when the Shortcut ran.


-- ── THE WRITER ────────────────────────────────────────────────────────────────
--
-- One call writes one morning. A function rather than a direct table write, for
-- the same three reasons recovery_auto_upsert is one:
--
--   1. A direct write sends the WHOLE slot, so the Shortcut would have to read
--      it, merge, and write it back. Any hiccup between those steps loses every
--      morning it already held. This merges server-side, one day at a time, so
--      the worst case is one morning missing rather than all of them.
--   2. A partial payload cannot do damage. Weight alone on Monday and weight
--      plus body fat on Tuesday both survive, because fields merge into the day
--      rather than replacing it.
--   3. The Shortcut stays trivial: one flat request, no JSON surgery.
--
-- SECURITY INVOKER (the default, stated outright) is the point: the function
-- runs as whoever called it, auth.uid() is that person, and the row-level
-- policy on vault_slots applies exactly as it does to the board itself. There
-- is no service-role key here and nothing that can reach another account.
create or replace function body_auto_upsert(
  p_date date,
  p_kg   numeric,
  p_fat  numeric default null,
  p_src  text    default 'apple-health'
) returns jsonb
language plpgsql
security invoker
as $$
declare
  uid      uuid  := auth.uid();
  day      jsonb := '{}'::jsonb;
  cur      jsonb;
  existing jsonb;
begin
  if uid is null then
    raise exception 'not signed in';
  end if;

  if p_date is null then
    raise exception 'a weigh in needs a date';
  end if;

  -- A date in the future is a clock problem, not a weigh in. Refuse it rather
  -- than file a morning that has not happened.
  if p_date > (current_date + 1) then
    raise exception 'that morning has not happened yet: %', p_date;
  end if;

  if p_kg is null then
    return jsonb_build_object('ok', false, 'date', p_date, 'reason', 'no weight in that request');
  end if;

  -- THE UNIT TRAP, CAUGHT HERE. 20 to 400 kg is wide enough to hold any human
  -- and narrow enough that a pounds figure sent as kilograms trips it: an
  -- 80kg man weighs 176 lb, and 176 "kg" lands outside. It cannot catch every
  -- case (a 100kg man reads 220 lb, also refused - good; a 45kg person reads
  -- 99 lb, which would pass) but it catches the shape of the mistake, and a
  -- refusal the Shortcut can show beats a silent lie in the trend for ever.
  if p_kg < 20 or p_kg > 400 then
    raise exception 'that is not a bodyweight in kilograms: %. Convert on the phone before sending.', p_kg;
  end if;

  day := jsonb_build_object('kg', p_kg);

  -- Absent, never zero. A scale that failed to read body fat sends nothing,
  -- and a zero percent body fat is a lie rather than a missing measurement.
  if p_fat is not null and p_fat > 0 then
    day := day || jsonb_build_object('fat', p_fat);
  end if;

  day := day || jsonb_build_object('src', coalesce(p_src, 'unknown'), 'at', now());

  select data into cur from vault_slots where user_id = uid and slot = 'body:auto';
  cur := coalesce(cur, '{}'::jsonb);
  if not (cur ? 'days') then
    cur := cur || '{"days":{}}'::jsonb;
  end if;

  -- Merge into whatever that morning already held, so a second run of the day
  -- adds a field rather than replacing the morning.
  existing := coalesce(cur #> array['days', p_date::text], '{}'::jsonb);
  cur := jsonb_set(cur, array['days', p_date::text], existing || day, true);

  insert into vault_slots (user_id, slot, data, updated_at)
  values (uid, 'body:auto', cur, now())
  on conflict (user_id, slot) do update
    set data = excluded.data, updated_at = now();

  return jsonb_build_object('ok', true, 'date', p_date, 'wrote', existing || day);
end;
$$;

-- EXECUTE never even evaluates without the grant, the same way RLS does not
-- without its grant. Always grant.
grant execute on function body_auto_upsert(date, numeric, numeric, text) to authenticated;


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
--   where slot = 'body:auto';
