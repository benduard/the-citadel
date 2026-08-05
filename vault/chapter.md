# The chapter

Where you are right now, and why it matters. The mentor keeps this current.

## Now

Building the board out into a training and recovery system. The direction is
Ruben's, given 2026-07-30: recovery, exercise, a daily check in, body weight,
and a gamified progress layer on top.

Three goals, all live in `lib/tiles/weights.ts`. He was asked to pick one and
said all three, which the equation supports on purpose: a tile is worth
different amounts to each, so a hard session serving "stronger" while costing
"feel good" is visible instead of hidden.

## The tile roadmap

Order matters here. Each one is a separate build, one at a time.

1. **Check in** - DONE, 2026-07-30. Five 0-10 scales, water, supplements, a
   note. Reports `checkin_score`. Manual, daily, thirty seconds. Built first
   because it needs nothing else to exist and it starts filling the ledger
   immediately.
2. **Lifting** - DONE, 2026-07-30, then rebuilt the same day into a ranked gym
   log at Ruben's request. Routines and hand written plans, a full log with a
   rest timer, exercise by exercise ranks, an overall gym rank, XP and levels,
   records, streaks, quests, titles, a muscle recovery estimate, a bodygraph
   and a searchable library. Size `big`, four way bottom navigation. Reports
   `lifting_volume` in kg, and nothing else.
   Things to not undo: weight is stored in kg ALWAYS and the unit toggle is
   display only, because a history that changes meaning when a preference
   flips is worthless. A PR is the heaviest set actually performed; the Epley
   figure beside it is labelled an estimate and never stands in for it. The
   rank ladder prints its own thresholds because it is a scale somebody chose,
   not a measurement. Bodyweight is held here for the ratio maths and is never
   reported, because Body owns that ledger row. XP is derived from history, not
   stored, so it cannot drift or be farmed.
   See `vault/decisions.md` for the four parts of the brief that could not be
   built as asked and what was done instead.
3. **Body** - DONE, 2026-07-30. Weight, stored in kg always, with a 7 day
   rolling average drawn only where a window holds 4 or more weigh ins.
   A single morning reading is water and food and time of day; presenting one
   as the truth misleads, and averaging two points into a trend is worse.
   Reports `body_weight`, goalDirection `neutral` because whether it should
   rise or fall is a fact about intent nobody has stated.
4. **Recovery** - DONE, 2026-07-30. Sleep, HRV, resting heart rate,
   respiratory rate, typed in. Reports `sleep_hours`.
   The readiness band is the part to not water down: it refuses to render
   until 7 mornings exist, baselines against that person's own trailing 14
   days rather than population norms, floors the spread at 4 percent of the
   mean so a flat fortnight cannot promote noise into a verdict, and lists
   every contributing metric underneath. Observation, never diagnosis.
5. **Progress and XP** - DONE, 2026-07-30. Quests, XP, levels, streaks.
   Self contained, because a sealed tile can only read its own slot and so XP
   cannot be awarded from the other tiles. The page says that plainly.
   Deleting a finished quest does not decrement `quests_done`; retired quests
   are counted separately so the ledger never walks backwards for a
   bookkeeping action. Ticks do not undo, so XP cannot be farmed.
   Weight zero in every goal: it is a lens on the other tiles, not its own
   input, and weighting it would count the same work twice.
6. **Notes** - DONE, 2026-08-04. Plain notes, the way the phone does them.
   The title is NOT stored: it is the first line of the body, computed every
   time, so editing line one renames the note and there is no second copy of
   the name to fall out of step. Saves 600ms after typing stops, and on blur,
   pagehide and visibilitychange.
   It reports NOTHING, and that is the decision to not undo. A tile reports one
   honest number or none, and there is no honest number in a note - a count of
   them is not progress toward any of the three goals. So it is absent from
   weights.ts for its own reason, separate from `progress`'s.

Seven tiles, verified together as well as alone: no cross-writes between slots,
no duplicate key+date ledger rows.

## What Ruben asked for on 2026-08-04, and what it became

Eight things, all shipped:

- RPE now shows in Lifting's "last time" panel and comes across with Use.
- Adduction and abduction are two exercises. That needed a new muscle -
  abduction is glute work, adduction is the inner thigh - so MUSCLES gained
  `adductors` and both body figures draw it. The old combined entry is RETIRED,
  not deleted: an exercise name is the key its history hangs on.
- A set no longer needs weight on it. It never invents load: on a movement
  carrying none of the body it is worth zero volume and the tile says so.
- The split is now a CHOICE. Five schemes plus days he builds himself. Split
  ids are namespaced forever, except the first scheme's, because
  `splits[date]` is the record of what a session was.
- Lists he makes himself, ids prefixed `u:`, reaching the ledger never.
- A calendar day expands into its hours. Times are optional and never
  inferred; untimed items sit in "Any time" rather than a plausible hour.
- Notes, above.
- Every big number now fits its box on a phone, measured rather than guessed.

Two traps found on the way, both now guarded by tests: a sealed frame silently
kills prompt/confirm/alert (`tiles/sealed.test.js`), and a browser check that
seeds the wrong store shape passes by measuring nothing (`number-check.js`).
Both are written up in `vault/decisions.md`.

## Where the board goes next

- **The wearable inlet** - STARTED 2026-08-05, the vault half is in. Ruben
  wants Recovery to fill itself from a ring or a watch, and the mentor to read
  the result back as pointers.
  His device runs on FitCloudPro, which has NO API, so the scheduled job that
  once stood here is dead for it. The direction is reversed instead: the phone
  pushes, out of Apple Health, through a Shortcut, into `recovery:auto` via
  `supabase/wearable.sql`. Health is the interface rather than any vendor, so
  swapping the ring for a watch costs nothing.
  Done: the function, the second slot, `VitalityRemote.setPassword`.
  Not done: the Shortcut, and the tile's "show both" face. Both wait on proof
  that anything reaches Apple Health at all, which was still unknown - a night
  was worn and Health showed nothing. See `vault/decisions.md`.

Otherwise nothing is queued. The obvious candidates, none of them started:
- Board LAYOUT does not sync yet. Tile data does. Which tiles you have hidden
  through the Library is still per device (`v:board` is localStorage only).
- Cardio, deferred when Lifting was scoped. Heart rate zones and active
  calories have the same wearable constraint as Recovery.
- Ruben's own deferred list: full nutrition, cognitive analytics beyond mood
  and focus, finances.

Deferred by Ruben, not forgotten: full nutrition, cognitive analytics beyond
mood and focus, finances.

## The constraint that shapes all of this

A sealed tile never fetches and never holds a key. So HRV, resting heart rate,
respiratory rate and sleep CANNOT flow in from a wearable by themselves. Three
honest paths, and no fourth:

- typed in each morning off the watch app, which works today
- something that already HAS the data pushes it in. On this board that is an
  iPhone Shortcut reading Apple Health and calling `recovery_auto_upsert`. This
  is the one being built, because Ruben's device has no API to pull from.
- an automation holding the API key, writing JSON into this repo, which the
  host fetches and hands to the tile as a feed. Still correct for a device that
  actually runs a cloud, like an Oura or a Whoop. Not an option for his.

Do not promise a tile that syncs a wearable on its own. It cannot.

## Editorial decisions made against the original plan

- Ruben's "Recovery" and "Daily Check in" lists were the same five subjective
  measures written twice. Merged into Check in. Two tiles logging one truth
  would double count in the ledger and disagree with each other.
- Hydration stays out of the ledger. A tile reports one honest number and for
  Check in that is the score. If water needs to be queryable across tiles it
  wants its own tile with kind 'intake'.
- A readiness score is fine to compute, and Check in already does a version of
  it, but it always shows its inputs and stays mint and amber. Never red, and
  never phrased as a medical judgement. See the design law in CLAUDE.md.
