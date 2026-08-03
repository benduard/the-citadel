# Decisions

What you decided and why, so a future session never re-litigates it.

## The board has a mark, and the iPhone home screen icon finally works

Decided 2026-07-31. Ruben's home screen tile was blank. The cause was not a
weak logo - the board shipped **no icon files and no icon tags at all**, so iOS
fell back to a screenshot of the page. There was nothing to fix, only something
to build.

THE MARK. `icons/mark.svg` is the master; every PNG is rendered from it by
`tools/build-icons.js`. Never hand-edit a PNG. A citadel from above: the
chamfered octagon wall, the keep standing inside it, the gate cut through the
base. The octagon is not a shape chosen for an icon - it is the board's own
signature cut, the same clip-path the rank panel and command surfaces already
use, so the mark is the board's geometry rather than a logo bolted onto it.
Gold because the design law reserves gold for identity and ceremony; petrol is
interaction and mint/amber judge how a person is doing, which an app icon must
never imply.

THREE SOURCE FILES, and each earns its place:

- `mark.svg` - the full mark, for 120px and up.
- `mark-small.svg` - the keep alone, for the 16 and 32px favicons. Below about
  48px the full mark's three elements stop being three things and become a
  grey blob. Shipping a simplified small variant is what real identity systems
  do; scaling the big one down is not.
- `mark-maskable.svg` - the same artwork scaled to 78%, for Android adaptive
  icons. Android crops maskable icons to a centred circle of 80% diameter, and
  the full mark's wall corners sit at radius 429 of 1024 against a 410 safe
  radius. Declaring the standard mark maskable would have let Android quietly
  shave the corners off the wall. `tools/icons.test.js` recomputes that
  geometry, so the claim cannot drift away from the artwork.

THINGS TO NOT UNDO:

- **apple-touch-icon must be PNG.** iOS ignores SVG for it, and ignores the
  manifest's icons for the home screen entirely - it looks for those link tags.
- **Those PNGs are opaque on purpose.** iOS composites WHITE behind any
  transparency, which would put a white box behind a dark mark. The graphite
  ground is baked in.
- **Both `apple-mobile-web-app-capable` and `mobile-web-app-capable` are set.**
  The Apple one is deprecated in favour of the standard one, but dropping it
  still breaks standalone mode on iPhone.
- `apple-mobile-web-app-title` is "Citadel", not "The Citadel", because the
  longer name wraps under the home screen icon.
- The header emblem in `index.html` is the same mark split in two: the
  chamfered plate is the wall, the glyph inside it is the keep. Redrawing the
  whole mark at 14px would be a gold smudge, for the same reason mark-small
  exists.

The first draft of the mark was drawn to look right at 1024px and checked at
60px - the real iPhone tile - where the keep had thinned to a sliver and the
gate had become a speck. Every weight in the file is set from the 60px render
backwards. If you change it, re-run the build and LOOK at the small output
before believing it.

## The shell was audited against a design skill, and four AI tells were removed

Decided 2026-07-31. Ruben asked for the UI to look less like it was generated,
using the `redesign-existing-projects` skill installed the same day. It was an
audit, not a reskin: the identity (graphite, gold, petrol, chamfered command
deck) did not change. Four things did.

**Archivo joins Inter as a display face.** Inter stays the body typeface - it
is genuinely right at the 12-14px that is most of this board, and it is the
design law. But Inter at EVERY size, including the headline moments, is one of
the most recognisable generated-design tells there is, flagged independently
by two different design skills. Archivo takes the greeting, the rank name, the
countdown and the wordmark: a technical grotesque with real width, which suits
an instrument panel. Never used for running text.

**The three goal cards became one panel of three rows.** Three equal cards in
a row is the single most-cited generated layout, and here it was also the
worse design: the whole point of those three is comparing which goal is
furthest behind today, and three columns means reading across a gap three
times. Rows share a left edge, so the fractions line up and the answer is
immediate. The goal needing attention is marked with a gold rule down its left
edge rather than a differently-coloured card - a border on one card of three
reads as a rendering glitch, a rule on one row reads as a pointer.

**The rank rows are capped at 620px.** They were stretching the full panel
width on desktop, putting a 1200px progress bar between a label at the far
left and its status at the far right - the two things you read together, as
far apart as the screen allows. The cap lives on `.attrs` itself rather than
on the grid column, because TWO states render those rows (ranked, and the
building countdown) and capping only the first left the countdown stretched.
The building state also gained the same two-column shape the ranked state
uses, or it grew a tall empty right half.

**A real radius scale and tinted shadows.** Everything was 12-14px radius with
pure-black shadows. Radius now tightens as elements nest (`--radius-xs` 3px
through `--radius-lg` 14px), and shadows carry the background's blue-grey hue
rather than neutral black, which on this ground read as dirt rather than
depth. Tiles also lift 2px on hover - killed under `hover: none` so iOS does
not leave a tile stuck raised after a tap.

WHAT WAS DELIBERATELY NOT CHANGED, though the skill says otherwise: it advises
picking a single accent colour. Here that would be wrong. Gold and petrol
(shell), mint and amber (how a person is doing), and Lifting's blue are
SEMANTIC and documented in this file - flattening them to one hue would delete
meaning the board depends on. That rule is written for marketing sites, not
for instruments. The background was already tinted graphite rather than pure
black, and the grain overlay already existed.

## Every tile's poster was invisible some of the time, and no test caught it

Found and fixed 2026-07-31, while setting up `tools/visual-check.js` at
Ruben's request for browser testing. Every plain-node suite in this repo was
green the entire time this was live on the real board.

THE BUG. Five tiles' poster faces (checkin, body, recovery, progress,
lifting) started at `opacity:0` and relied on a CSS entrance animation to
become visible. Six sealed iframes mount at once on boot, and Chromium
sometimes never starts a fresh cross-origin iframe's CSS animation before its
own paint budget runs out. The poster then sits at opacity:0 FOREVER - not
slow, not delayed, permanently invisible until the page is reloaded and the
race happens to go the other way. Confirmed flaky across 10 repeated real
loads of the real board with a real Chromium (not a headless-only artifact -
opacity was read from the live computed style, same as a person would see).

TWO SEPARATE CAUSES, found in that order:

1. `.tile`'s chamfered-corner `clip-path` (added in the shell reskin,
   `vault/decisions.md`'s earlier entry) sat on the DIRECT PARENT of every
   sealed iframe. With it present, the bug was not flaky - it was 100%
   reproducible, every tile, every load. Proven by toggling clip-path off on
   the live served file and reloading: opacity went from 0 to 1 with that one
   property changed and nothing else. Fixed by dropping `.tile` to a plain
   `border-radius` instead. `overflow:hidden` alone does NOT cause it and was
   left in place - only clip-path on an iframe's ancestor does this.
2. Even with clip-path gone, the underlying race remained: five tiles still
   started invisible and depended on `animation:rise ... forwards` to reveal
   themselves, and that still lost the race a fraction of the time. Fixed by
   removing the opacity:0/animation dependency from each poster - content now
   defaults to visible, full stop. `lists.html` never had this pattern and
   never once failed across every test run; that was the tell.

WHAT WAS DELIBERATELY NOT TOUCHED. `progress.html`'s `.quest` entrance
animation and `lifting.html`'s `.rise` class on `pgHead`/`#wSeg` look
identical but are NOT implicated: both only render inside a tile's full PAGE
view, opened one iframe at a time via `openPage()`, never racing five
siblings for the compositor on a cold boot. Confirmed by testing before
changing anything. Only `lifting.html`'s poster instance had `rise` removed;
the shared `.rise` class itself is untouched.

THE LESSON, worth keeping: a CSS entrance animation must never be the only
path to visibility for content inside a sealed iframe. Fade-ins are fine as
enhancement; they are not fine as the mechanism that makes something exist on
screen. If a future tile wants a poster fade-in, default it to visible and
treat the animation as decoration that can silently fail to play.

HOW IT WAS FOUND. `tools/visual-check.js`, a Playwright script that loads the
real board in a real Chromium and reads real computed styles, repeated over
several fresh loads specifically because the bug was probabilistic. Every
suite in this repo before that point tested the CODE that produces a page,
never the page itself, and none of them could have caught this by
construction. See `tools/` for setup; it is optional and not part of
`run-tests.sh`'s guaranteed-green baseline, since it needs a Chromium binary
on disk and the board actually running.

## Projects became Lists, and it sits at the top of the board

Decided 2026-07-31.

He asked for a Lists tile at the top holding a daily to do list, a grocery
list, a pending project list, and whatever else made sense for him.

THE ID IS STILL 'projects'. The file is `tiles/lists.html` and the board says
Lists, but the registry id did not change and must never change. The id is the
vault storage key: renaming it points the tile at an empty slot, orphans every
project already saved, and breaks `projects_done` in the ledger along with its
weight in weights.ts and its row in lib/rank.js. The name is free, the id is
not. Both files say so at the top.

Five lists. Three he named, two recommended, and the recommendations exist to
protect the daily list rather than to pad the tile:

- Daily, rolls each day
- Weekly, rolls each Monday. The shop, meal prep, laundry, admin - things with
  a weekly rhythm that clog Daily and are not projects.
- Grocery, rolls never. Tick while shopping, clear when home.
- Projects, rolls never. The only list that reaches the ledger.
- Someday, rolls never. Capture, with one action: send it to Daily. A daily
  list you scroll past is a daily list you stop reading, and this is what keeps
  it short.

Things to not undo:

- ONLY the projects list reports, and it reports `projects_done` counting
  exactly what v1 counted. A daily to do is not a project finished. Folding
  both into that key would make every ledger row written before today a lie
  about what it counted. A daily-tasks number in the ledger is a real decision
  - its own key, its own weight in weights.ts, its own row in rank.js - not a
  side effect of this tile.
- ROLLING NEVER DELETES. A finished one-off leaves the live list but keeps its
  text and its date in `archive` (capped at 200, newest first). A list that
  quietly eats what you finished is a list you stop trusting.
- A blank roll marker rolls NOTHING and only sets itself. Without that, the
  first ever run would archive work finished minutes earlier.
- Clear finished is not offered on Projects, because it would walk
  projects_done backwards for a bookkeeping action. Same law the Progress tile
  already follows for retired quests.
- Repeating items uncheck rather than archive, so a daily habit and a one-off
  task can share the list without either behaving wrongly.

v1's `{ projects: [...] }` migrates into `lists.projects` untouched.
`tiles/lists.test.js` covers the migration, every roll rule, the first-run
trap, and that groceries can never inflate projects_done.

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

## The Lists calendar records completions, it does not derive them

Decided 2026-07-31.

Ruben asked for a calendar tied to the daily checklist: cross something off and
it crosses off on that day, and anything not crossed moves to the next day
until it is.

The carry-forward half already existed. `roll()` has always kept unfinished
items on the list day after day. What was missing was making it visible, so an
uncrossed item now says how long it has been following you: faint for a day or
two, amber at three, never red. An old to do is not a failing.

The calendar itself could not be a new tile. Sealed tiles cannot read each
other, so a separate calendar tile physically cannot see the checklist. It
lives inside Lists as a second view. Architecture decided that, not taste.

It records rather than derives, and that was the real decision. The obvious
build reads doneAt and the archive, and it fails silently: `roll()` sets a
repeating item's doneAt back to null and a repeating item never reaches the
archive, so a habit ticked every day for a month left no trace by the next
morning. The exact thing a calendar is for. `state.done` writes the day at the
moment it is crossed. The test for this asserts BOTH that the record survives
a roll and that no other trace of it is left, so nobody can ever "simplify"
the log away.

`logFrom` is the honesty line. Working backwards from createdAt would paint
every day since an item was made as a day of misses, including days before
this tile recorded anything. That is inventing failures. Days before logFrom
show whatever real crossed-off marks exist and are never scored.

A missed habit is not a carried task. A one-off is owed and accumulates age; a
repeating item is due again. Calling a habit "27 days old" turns a rhythm into
a debt, so it does not.

## The close-button lane now has a permanent check

Decided 2026-07-31.

The host floats a close button over the top right of every page tile. Three
separate times something in a tile's own header ended up underneath it: the
shell's Library gear vs the sync pill, the Body tile's unit toggle, and the
Lists count pill, which had been clipped since before the calendar existed.
Every plain-node suite stayed green through all three, because the overlap only
exists once a real browser has laid both documents out.

`tools/collision-check.js` now measures every page tile against the button
across sixteen widths. The trap it exists to catch: there is no single correct
breakpoint. The button sits at viewport-52, so the width where a tile clears it
depends on that tile's own column. Copying the Body tile's 640px into the wider
Lists tile left a 4px overlap at 700px, which is how the number 760 was
arrived at - measured, not inherited.

## The mark is a citadel, and there is only one copy of it

Decided 2026-07-31.

The home screen showed a plain letter C. Not a design problem: the board had
never been deployed with any icons, so iOS fell back to generating a letter
tile from the page title. The mark below is the redesign Ruben asked for on
top of that; the C was fixed by pushing.

It is a citadel in elevation now - crenellated wall, three towers, a gate arch,
arrow slits - on the hexagonal plate the header emblem uses. The old mark was a
top-down chamfered octagon whose code comment claimed it was the same shape as
the emblem. It was not: the emblem plate has six sides and that mark had eight.
They match now because the numbers are the same numbers.

Detail is budgeted from the render, not the canvas. The iPhone tile is 180
physical pixels on a 3x screen, so a unit of the 1024 canvas is 180/1024 of a
pixel and nothing under about 20 units survives. Every merlon, notch and slit
is at least 24. That is why the mark can carry this much detail at all, and it
is the number to check against before adding more.

The maskable variant is no longer a second file. It was a hand-kept copy of the
artwork and it had already drifted an entire redesign behind the master. Now
tools/build-icons.js scales the master's #art group and leaves the ground full
bleed, so there is one drawing. tools/icons.test.js recomputes the plate's real
corner radius out of mark.svg and checks the scale still clears Android's 409.6
safe radius, in both directions - too big fails, and so does padded-to-a-speck.

Two things the small sizes taught, both found by looking rather than reasoning:
a tall block with a deep notch and a gate reads as a capital H at 16px, and at
that size the hexagon is the only element that survives at all. The 16/32px
variant is therefore the plate with a wide, shallow battlement inside it, and
the header emblem uses two merlons rather than three for the same reason.

One test lesson worth keeping. The maskable geometry check used to find the
plate by its literal starting coordinates. Moving the plate made it match
nothing, which sent an empty list into Math.max, produced -Infinity, and PASSED.
It now finds the path by what it is (the shape filled with the plate gradient)
and treats unmeasurable as Infinity, so it fails loudly instead. A geometry
test that passes when it cannot find the geometry is worse than no test.

## The body map colours by sets, and says its attribution is a convention

Decided 2026-08-01.

Ruben asked for an anatomy chart showing what he trained hardest that week and
what he neglected, weighted by the exercises he did and how he performed on
them. It lives in Lifting under Workouts > Body map: a front and a back figure,
mint where the work went, an amber outline where none did.

Two calls in it are worth keeping written down.

SETS, NOT KILOS, DRIVE THE COLOUR. The obvious build shades by volume, and it
is wrong in a way that never announces itself: a quad moves hundreds of kilos
and a rear delt moves tens, so a kg-shaded figure paints legs bright and
shoulders dark every single week no matter how they were actually trained. It
would look informative and be the same picture forever. Effective sets are the
unit that compares between muscles, and sets per muscle per week is what
training practice counts anyway. Volume is still shown as a number, in the
places it informs instead of misleading.

ATTRIBUTION IS A CONVENTION AND THE PANEL SAYS SO. A set of bench counts once
for chest and half for shoulders and triceps. Nobody measured that on Ruben. It
is the same 1.0 / 0.5 split muscleRecovery() has always used in that file, and
it is kept identical on purpose so two panels in one tile can never disagree
about what a set did - the test asserts there are exactly two of them in the
file. The colour is also explicitly relative to his own hardest-hit muscle that
window; it never claims a muscle got "enough", because that needs a target this
board has never been given.

The empty state was a real bug, caught on screen and not by the maths tests:
with nothing logged, all sixteen muscles took the amber "you skipped this"
outline and the whole figure read as a warning about nothing. Amber is caution,
and caution is only honest once there is training to compare against. An empty
log now draws neutral.

## Rest follows the lift, and progression is suggested from a plateau

Decided 2026-08-01.

REST. One fixed rest number gave a five rep squat and a set of neck curls the
same two minutes. It now reads from the exercise: 5:00 heavy barbell compounds,
3:00 other multi-joint work, 2:00 single-joint isolation. The tiers come from
what the evidence separates - heavy compounds are limited by systemic fatigue
rather than by the muscle, and cutting their rest costs reps outright, while
isolation clears fast. The Rest button says the length before it is tapped.

The tier is derived from `w`, the weight the rank maths already carries, rather
than a fourth hand-kept column that could drift out of step with the library.
But `w` was calibrated for RANKING, not fatigue, and gets a handful wrong -
those are named in REST_OVERRIDE. Two of them, Incline Barbell Press and
Pendlay Row, were found only because the test walks the entire library and
asserts a sane tier for every lift; spot-checking the obvious ones missed both.

PROGRESSION. The suggestion fires on a plateau in load with no regression in
reps: same top-set weight three sessions running, newest reps at least matching
the oldest. Deliberately NOT a rep target - a rep range only exists when a
routine supplies one, and asserting "8 is the top of your range" would be
inventing a fact about how he trains. Three sessions of no movement on load is
observable from the log by itself.

DELOAD is set by hand and never inferred. A planned light week and a bad week
are identical in a log, and guessing between them would feed a made-up fact
into the progression maths. A marked week stops counting toward "ready for more
weight".

What deload does NOT do, and why: it does not reach the board-wide rank in
lib/rank.js. That reads the LEDGER, which is one shape for every tile
(key, value, date, source) - teaching it about deload weeks would mean widening
that shape for one tile's concept. Not worth it, so the rank still reads a
deload as a quiet week. Said plainly here rather than half-built.
