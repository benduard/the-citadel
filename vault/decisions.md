# Decisions

What you decided and why, so a future session never re-litigates it.

## Lifting knows Ruben's three way split, and the picker follows it

Decided 2026-07-31. His split, in his words: legs, then chest and shoulders
with abs, then back and arms.

`SPLITS` in `tiles/lifting.html` is plain data, three entries, each one nothing
more than a set of PRIMARY muscles:

- Legs: quads, hamstrings, glutes, calves
- Chest & Shoulders + Abs: chest, shoulders, abs, obliques
- Back & Arms: lats, traps, rear delts, biceps, triceps, forearms, lower back

Pick a day and the exercise picker narrows to it, regrouped BY MUSCLE rather
than by push/pull/legs, because on a leg day "Quads / Hamstrings / Glutes /
Calves" is the question and "Legs" as one heading answers nothing. Inside each
muscle the biggest lifts come first, ordered by the same `w` the ranks use, so
the top of every group is the lift worth building the day around. That ordering
is the whole of the "recommended" part - no model, no scoring, just his own
library sorted by how much lift it is.

Decisions worth keeping:

- Matched on PRIMARY muscle only. Bench hits triceps but is not a triceps
  exercise, and a picker claiming otherwise on arm day is worse than no filter.
- Triceps sit on Back & Arms, not chest day, because he trains arms with back.
  That is his split, not the conventional one, and the file follows him.
- "Everything" is always one tap away. A split is a plan, not a cage, and
  nothing is ever hidden for good.
- A custom exercise whose muscle is not in today's split still appears, under
  "Yours, other days". Otherwise a lift of his own could become unloggable on
  the very day he built it for.
- The choice is stored PER DAY (`S.splits[date]`), not as one sticky setting,
  so the log remembers what each session was and a new morning never inherits
  yesterday's plan. It also means "when did I last train legs" is answerable
  from the log, which the picker now shows.

THE INVARIANT, and the reason `tiles/lifting.splits.test.js` exists: every
muscle in MUSCLES must appear in exactly one split. Miss one and every exercise
that trains it silently vanishes from every split with no error anywhere; list
one twice and the same lift turns up on two days. The test fails loudly on
both, and was checked by deliberately breaking it. Edit SPLITS freely and let
the test referee it.

## The board tells itself when the ledger changes

Decided 2026-07-31, out of the audit of that day's work.

The rank and today's coverage read the ledger. A sealed tile writes to it and
cannot say so, so both panels sat one workout out of date until a full page
refresh - you could log a session, close the tile, and watch the board insist
you had not. `host.js` now fires a `vitality:ledger` event the moment a report
LANDS (never on a failed write, which would redraw the board and imply a log
was saved when it was not) and the shell re-reads on it.

The same pass made that a single read. Both panels used to fetch the ledger
themselves, which on a signed-in board is two session lookups and two full
table reads for one screen, and let them disagree by being fetched a moment
apart. `refreshBoard()` reads once and hands the rows to both.

## Lifting shows last time's sets, matched by position

Decided 2026-07-31.

Ruben asked to see what he did on each set of an exercise the last time he
trained it, while entering the current session, so he knows which number to
beat. It sits under the exercise picker on the Log a set card.

- "Last time" is the most recent day BEFORE today containing that exercise.
  Never today: today is the session being compared, and folding it in would
  have him chasing a number he hit an hour ago.
- Sets match BY POSITION, in log order. Set 2 today is aimed at set 2 then,
  which is the whole point of the ask. The set he is about to do is
  highlighted; the ones already done show how they compared.
- Comparison is by VOLUME (load x reps), not weight alone, so 100x8 beating
  100x6 counts. Bodyweight movements include the body, so more pull ups reads
  as up even with nothing on the bar.
- The "Use" button FILLS the form, it never logs. A button that silently wrote
  a set would put work in his history his body never did, and every rank on
  this board is built on that history.
- Past last time's set count, it says so rather than running out of rows.

Two things caught by `tiles/lifting.lasttime.test.js` (plain node, no
framework) that would otherwise have shipped:

- `niceDate` already existed and returns the short "24 Jul" that the session
  and PR lists are built on. A second one would have silently overridden it
  and changed both. The new one is `lastTimeWhen`.
- The file had no `esc` and everything else builds nodes with textContent.
  Custom exercise names are typed by hand, so the new panel escapes them.

## Nothing thins out the training log, and the ceiling is now visible

Decided 2026-07-31.

He said he has plans for this data later. Nothing in the tile prunes history
and nothing should ever be added that does. The only place a day is removed is
when its last set is deleted by hand, which is housekeeping, not pruning.

The real risk was the host's 512 KB per tile cap: saves fail loudly at the
wall (save:error, which the tile already reports), but finding out AT the wall
is no use for a log whose whole promise is that it keeps everything. Profile
now shows the actual serialised size, the sets logged, and roughly how many
more fit at the size his own sets run. Over 80% it turns amber and says to
raise it before anything is at risk. Splitting the log by year is the fix when
that day comes; do not answer it by deleting old sessions.

Signed in, all of it is in Supabase `vault_slots` as one JSON blob per tile,
so the per set detail is queryable there. The ledger holds the daily volume
total separately. That is where any future plan for this data should read from.

## The board has one rank, Bronze to World Class, and it ranks the habit

Decided 2026-07-31.

Ruben asked for weights on each attribute and a single game-style rank across
every log. It is in `lib/rank.js`, plain data, with `lib/rank.test.js` beside
it (plain node, no framework: `node lib/rank.test.js`).

The weights were NOT invented. He was asked once to pick one goal and said all
three, so all three count equally and each tile's weight is the average of what
he already gave it across the three goals in `weights.ts`: Check in 32,
Lifting 28, Recovery 25, Projects 10, Body 5. If weights.ts changes, recompute
these by hand. Nothing generates one from the other.

Half of the score is showing up (days logged against a target cadence), half is
improving (last 14 days against the previous 14). That split is what makes the
three tiers mean something sayable:

- perfect cadence while every number slides -> 50 -> Gold
- perfect cadence, numbers flat             -> 75 -> Platinum
- perfect cadence, numbers climbing         -> 100 -> World Class

So Diamond and above cannot be bought with consistency alone, which is what
"rank me on how I'm improving" has to mean. A flat fortnight scores the MIDDLE
of the improving half, never zero: holding steady is not failing.

Things to not undo:

- It compares him to himself, fortnight over fortnight. There is not one
  population norm in the file, and there must never be. No "8 hours is an A".
- It refuses to rank under 28 days of history and shows a countdown instead.
  Same promise Recovery's readiness band makes. A rank off one fortnight has
  no comparison inside it and would be a made-up number.
- `body_weight` is counted for logging it and NEVER as a direction, because
  its goalDirection is 'neutral' - nobody has said whether it should rise or
  fall, and scoring it would be inventing his goal for him.
- `quests_done` (Progress) is excluded entirely, for the same reason it has
  weight zero in every goal: it is computed from these tiles and would count
  the same work twice.
- `projects_done` is a CUMULATIVE counter. It is read as how much the total
  MOVED per window, not as its raw value. Comparing the raw number would score
  "improving" forever, which was a real bug caught by the tests.
- A tile he has never once logged is EXCLUDED, not scored zero. This was the
  other real bug: never opening a tile was dragging the whole rank down as if
  not starting were the same as failing. A tile he used and then stopped does
  score zero rhythm, because that is a true signal and hiding it would lie.
- The ladder thresholds, the target cadence (checkin 7/wk, recovery 7/wk,
  lifting 4/wk, body 3/wk) and the 25% trend cap are an editorial scale
  somebody chose. The panel prints all of them behind "How this is worked
  out", the same law the Lifting ladder follows. Lifting is 4 and not 7 on
  purpose: his goal says "without breaking down", so scoring rest days as
  failure would rank against his own stated goal.

Named apart from the Lifting tile's ladder (Wood/Stone/Bronze/.../Olympian) on
purpose. That one ranks what he lifts; this one ranks how he lives. Two ladders
sharing names would read as one thing.

## Sign in is revdtheone@gmail.com, not xboxmanager64@gmail.com

Decided 2026-07-29.

The board's Supabase account is under revdtheone@gmail.com. That is not a
preference, it is a constraint: sign in email is sent through Resend, and
Resend's no-domain sender (onboarding@resend.dev) will ONLY deliver to the
address on the Resend account itself. Mail to any other address is rejected
with a 550 and never arrives. The Resend account is revdtheone@gmail.com, so
that is the address the board signs in with.

Signing in with xboxmanager64@gmail.com fails silently from the board's side:
Supabase returns 500 and the mail never sends. This was diagnosed once, in
Supabase's Auth logs. Do not re-diagnose it.

To change this, a real domain has to be bought and verified at
resend.com/domains, and the sender address changed to use it. Until then, the
address above is the one that works.

## Email goes through Resend, not Supabase's built in sender

Decided 2026-07-29.

Supabase's built in email service is capped at a few messages an hour, which
runs out during normal testing and looks like a broken sign in. A free Resend
account (3000/month, 100/day) is configured as custom SMTP instead:
smtp.resend.com, port 465, username literally "resend", password is the API
key, sender onboarding@resend.dev.

## Sign in is by typed code, not only by clicking the emailed link

Decided 2026-07-30.

The board is installed to an iPhone home screen. iOS treats that icon as its
own window, separate from Safari. A link tapped in Mail opens Safari, which
can never hand a session to the already open icon, so link sign in appeared to
"work" while never signing the actual app in.

The sign in email now carries a code as well as a link. Typing the code
verifies directly (auth.verifyOtp, type 'email') with no redirect, so it signs
in whichever window is already open. This required adding {{ .Token }} to BOTH
the "Magic link or OTP" and "Confirm signup" templates in Supabase's dashboard,
because a first sign in and a returning sign in are sent from different
templates.

The code input has no fixed length on purpose. Supabase's OTP length is a
project setting, and hardcoding six characters silently truncated a longer one.

## Lifting is a ranked gym log, and the ladder is a published scale

Decided 2026-07-30.

Ruben asked for the LiftOff app rebuilt in the Lifting tile. It was, with
original branding, original artwork and an original rank ladder: Wood, Stone,
Bronze, Iron, Steel, Silver, Gold, Titan, Olympian, three divisions each, 0 to
100 Lift Points inside a division.

He was offered carrying the old sets forward and chose a clean start. A v1 blob
is read once for the display unit and nothing else. Do not "restore" it later.

The ratios behind every rank are an editorial calibration, not a measurement.
That is why all nine per exercise are printed on the Ranks page beside what
they mean in kilograms for him. If a future session tunes a ladder, the table
has to stay honest about being a scale somebody chose. Never present a rank as
a fact about his body.

Four parts of his brief could not be built as asked and are answered on screen
rather than quietly dropped:

- AI generated plans. No key in the app, ever. Four plans are written by hand
  and shipped with the tile. New ones get written in Claude Code and added.
- Exercise animations. A sealed tile cannot fetch a video. Seven movement
  patterns are drawn in SVG and labelled as patterns, not form demonstrations.
- Muscle recovery. Estimated from logged volume alone, decayed over 72 hours
  for large muscles and 48 for small. It says so in the card. It is not a
  physiological reading and must never be dressed as one.
- Haptics. navigator.vibrate does not exist in iOS Safari, so it is dead on his
  phone. Wired for Android, and the Profile page says it plainly.

Electric blue was his request and it conflicts with the board's design law.
Resolved by scope, not by overruling either: blue is the game layer only, ranks
and Lift Points and XP and the bodygraph. Anything judging how he is doing
stays mint and amber, and nothing is ever red. A rank is a scoreboard,
recovery is a person.

Bodyweight lives in this tile for the rank maths and is deliberately NOT
reported to the ledger. Body owns body_weight, one row per key per date, and
two tiles writing it would overwrite each other every morning.

## Supabase sync was wired up now, not left for a later episode

Decided 2026-07-29.

The seed ships expecting sync to arrive in a later episode, and the board to
run on device storage until then. Ruben asked for it early, after being told
plainly it meant building real sign in. It was built, audited, and the audit's
findings fixed.

Consequence to remember: data is per account now, not per browser. Signed out,
the board still runs on this device's local storage exactly as the seed did.
