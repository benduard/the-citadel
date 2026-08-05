# Decisions

What you decided and why, so a future session never re-litigates it.

## The task titles went vertical, and the check written for it was blind

Reported 2026-08-04: the letters on his tasks were running down the screen
instead of across.

THE CAUSE. Lists' item row is a flex row carrying a checkbox, the title, up to
two tags, a time input, a move select and a remove button. Measured on his
phone width, those controls came to 335px on a 284px row. The title was the
only flexible item, and `flex:1; min-width:0` let it give ALL of its width: it
rendered at literally 0px, wrapping one character per line. The two controls
added earlier that day - the time input at 101px and the move select at 84px -
are what tipped it over.

THE FIX is two halves and it needs both. `flex-wrap` on the row so the controls
can drop to a second line, and a REAL `min-width` on the title so they are
forced to: without the floor the title still collapses and nothing ever wraps,
because a zero-width item always "fits". The time input and move select were
also boxed to widths a row can carry.

THE PART WORTH REMEMBERING IS THE CHECK. tools/squeeze-check.js was written to
catch this, it reported "no text is squeezed" with the original bug restored in
the file, and it looked completely correct. Two faults:

- It skipped any element with `width === 0` as "not rendered". A squeezed title
  is EXACTLY zero-width. The check was structurally blind to the one thing it
  existed to find. It now filters on height alone.
- Its first line-count divided scrollHeight by line-height, which counts
  PADDING as text - every button on the board came back as three lines. It now
  measures a Range over the element's contents, which returns one rectangle per
  real line.

And the first mutation test PASSED, because it only reverted one of the two CSS
properties and `flex-wrap` alone was enough to hide the bug. A mutation test
that does not verify its own edit landed, and does not revert the whole fix,
proves nothing. The script now throws if the text it means to replace is not
found.

## The notch reaches inside a sealed tile, and it ate half the small cards

Found 2026-08-04, from Ruben on his phone: the check-in score sat low in its
box with most of the number cut off. Every desktop check was green, and the
number-fit check that had just been written was green too.

THE CAUSE. `env(safe-area-inset-top)` RESOLVES INSIDE A TILE'S IFRAME. Verified
directly: with the inset overridden, a sealed tile's own document reports 59px
just as the shell does. Every tile applied the four safe-area paddings to
`body` unconditionally, in both modes. In the grid an s-sized card is about
122px tall, so on an iPhone home screen 59px of it became padding at the top
and 34px at the bottom - and the number was pushed 29px past its own fold.
Five of the seven tiles were affected; Lists and Lifting only escaped because
they are two rows tall.

THE FIX. Safe-area insets belong to PAGE MODE ONLY. Full screen, the tile IS
the viewport and genuinely needs them. In the grid it is a small card in the
middle of the board, nowhere near the screen edge, and the shell already keeps
its own distance from the notch - so the inset there is wrong by definition,
not merely inconvenient.

TWO LESSONS ABOUT THE CHECK ITSELF, both worth more than the bug:

- The first version COMPUTED the vertical overflow and never asserted on it.
  A signal you collect and do not check is not a check.
- The first attempt to simulate the notch injected
  `body{ padding-top:59px !important }`. That is worse than useless: it forces
  the padding on regardless of what the tile's CSS says, so it reports the same
  failure whether or not the bug is fixed. A simulation that cannot tell those
  two apart proves nothing. It now uses the DevTools protocol's
  `Emulation.setSafeAreaInsetsOverride` so the BROWSER resolves env() itself,
  and it was mutation-tested by putting the bug back on one tile - which fails
  that tile alone, in the notch pass alone.

Anything on a poster that reacts to the viewport now has to be measured in the
notch pass too, because a desktop browser structurally cannot see this class of
bug.

## A sealed tile cannot open a modal, and must never be allowed to

Found 2026-08-04 building the Lists changes. Lists grew a "New list" button
that asked for the name with `prompt()`, and a "Delete list" that asked with
`confirm()`. Both worked perfectly with the file opened on its own. Both did
nothing whatsoever on the real board - silently, with an empty console.

The cause is the seal itself. A tile runs in `sandbox="allow-scripts"` with no
`allow-modals`, so the browser blocks `prompt`, `confirm` and `alert` outright:
prompt returns null, confirm returns false, and nothing anywhere says why. Code
that branches on the answer takes the "cancelled" path for ever. The failure
looks exactly like a dead button.

THE FIX IS NEVER TO ADD allow-modals. That flag would apply to every tile on
the board, including one fetched from someone else's repo, and a sealed frame
that can throw a blocking modal over the whole page is a worse tile than one
that cannot ask a question. Anything needing an answer gets built out of
elements in the page:

- naming a list is an input row that opens under the tabs
- deleting a list ARMS the button - first tap says what goes, second tap does
  it - and any other render disarms it
- setting a time is a native `<input type="time">`, which is the OS picker on a
  phone and is not a modal

`tiles/sealed.test.js` now guards both ends: no tile calls a modal, and the
host never hands one the permission to. It was mutation-tested by putting the
prompt back, which fails it.

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

## The close button clears the notch, and habits sit apart from the day

Decided 2026-08-03.

THE CLOSE BUTTON. Reported from a real iPhone: it overlapped the status bar and
was hard to hit. Two causes. It was 36px, under Apple's 44px minimum, and it
was positioned at a bare top:14px while index.html ships viewport-fit=cover
with a black-translucent status bar - so the overlay genuinely runs underneath
the clock and battery. It is 46px now.

The inset went on the OVERLAY, not only on the button, and the reason is worth
keeping. The button is position:fixed, so it measures from the viewport, not
from the frame. Pushing only the button down by the notch would have driven it
into the tile's content instead of lining it up with the tile's header - a
different bug wearing the same fix. Padding .vPage moves the frame's top edge
instead, so inside the frame the geometry is identical to desktop, which is the
arrangement collision-check.js already proves has a clear lane at every width.
It also does not depend on env() resolving inside a sealed iframe, which is not
a thing this repo can test.

NONE OF THIS IS VERIFIABLE HERE, and that is stated in host.js next to the
code. Headless Chromium has no notch, so env(safe-area-inset-top) is 0 in every
check we can run and the button measures 12px from the top. The calc is
confirmed valid (it computes to 12, not to auto) and the size is asserted in
lib/shell.test.js, but the real inset only exists on the device.

HABITS VS THE DAY'S WORK. Daily mixed two different jobs into one list. A
one-off is today's actual work and changes every day; a repeating item is a
habit that returns on its own. Mixed together, the habits sit there every
morning making a short day look long, and the things genuinely due today get
buried under them. The day's own work leads now, and standing habits get their
own section beneath it. Only lists that can repeat get the split - an empty
second heading on Grocery is just furniture.

One trap worth naming: the empty state. With the one-off list empty but habits
still open, "Nothing open" would have been a lie with the answer visible three
lines below it. It reads "Nothing just for today. The standing ones are below."

## Touch targets get a permanent check, because every one was found by hand

Decided 2026-08-03.

Every mobile sizing problem on this board was reported by Ruben from his phone
rather than caught by anything here: the close button under the status bar, the
Body tile's unit toggle behind it, and then a whole set of 32-40px controls
that read fine with a mouse and sit under Apple's 44px minimum with a thumb.

tools/touch-check.js now drives a real touch context and measures every
control, on every tab of every tile. It found 18 the first time it ran - the
split buttons, every segmented control, the Lists tabs, the exercise pickers,
the Lists "Repeats every day" row at 22px, and the Body unit toggle. All were
live on his phone.

The fixes are scoped to @media (pointer: coarse) so the desktop layout keeps
its density. Two things learned doing it:

A MEDIA QUERY ADDS NO SPECIFICITY. The first version of Lifting's block sat
high in the sheet, so .splitBtn{min-height:40px} further down won on source
order and the split buttons silently stayed at 40 while everything around them
grew. The block is last in the file now, with a comment saying why.

GROW THE HIT AREA, NOT ALWAYS THE CONTROL. The Check in switch is 56x32, which
is the familiar size for a switch and worth keeping. Its ::after is padded 6px
top and bottom instead, so it looks identical and measures 44. The check reads
the padded box rather than the border box, or it would have flagged a control
that is genuinely fine.

The check also knows what NOT to flag: an input inside a label is tapped
through the label, and a label with no control inside is a caption pointing at
a field, not a target. Measuring those produced four false positives on the
first run, and there is a Recovery caption at 145x11 that is not a bug.

## Rest-timer push, and why the switch is not in the Lifting tile

Decided 2026-08-03.

A rest timer that lives only in the page dies the moment the phone locks -
JavaScript stops and setTimeout never fires. Surviving that needs something
outside the phone to send a push, so: a service worker at the repo root, two
Supabase tables, and an Edge Function that pg_cron calls every 15 seconds.

THE SWITCH IS IN THE LIBRARY, NOT IN LIFTING, and that is forced rather than
chosen. A sealed tile has an opaque origin: reaching the parent throws, and
localStorage throws. Checked rather than assumed - a sealed frame reports
serviceWorker and PushManager as present, because feature detection only reads
the API names, but registering from an opaque origin fails the same way
storage does. Only the host can subscribe, so the host owns the switch.

The tile therefore ASKS. Vitality.restTimer(seconds, label) is a new bridge
message, and a host that has never heard of it ignores it - which is what the
hosted Vitality board will do, leaving that same tile file working there
untouched. It is fire and forget: the countdown on screen is the real timer,
the push is the backup, and nothing about a failed schedule may disturb it.

A TIMER IS MARKED FIRED WHETHER OR NOT A DEVICE TOOK IT. The tempting version
only marks it on success, and then one broken subscription makes that timer
retry every 15 seconds for ever. A notification already late is not worth that.
Dead subscriptions (404/410) are deleted rather than retried.

15 seconds of slop is real and stated up front. pg_cron does take sub-minute
intervals, so this is a supported cadence, not a trick - but a rest timer can
arrive up to about fifteen seconds late and that is the honest number.

The private key is in .env.local, which .gitignore already covered, and
tools/push.test.js asserts that exact string appears in no committed file. The
public key is in lib/push.js on purpose: the browser hands it to the push
service at subscribe time, exactly like SUPABASE_ANON_KEY.

IT IS LIVE, 2026-08-04. All four steps are in, driven through the Supabase
console: push_subscriptions and rest_timers exist with RLS on and both policies
attached, the three VAPID secrets are set, send-timer-push is deployed, and
pg_cron calls it every 15 seconds with prune-rest-timers at 04:00 daily.

RUBEN PASTED THE SERVICE_ROLE KEY, NOT CLAUDE, and that is the standing rule.
A key goes into a field by his hand or it does not go in. Claude staged the SQL
with a placeholder and stopped there. Everything else around it was automated.

TWO TRAPS, both caught only because output was verified rather than trusted.

First, the SQL editor's Monaco autocomplete silently rewrote `returns void`
into `returns storage.vector_indexes` when text was typed in. Typing into that
editor is gambling. Paste, then hash the editor's content against the file and
compare, every time. That is how the real push.sql and index.ts were confirmed
byte-identical (3084 chars / e03cad1, and 4660 chars / bbfaec5a) before running.

Second, and worse because it looked like success: pasting over the placeholder
ate the `Bearer ` prefix, leaving `'Authorization', '<jwt>'`. cron.schedule
accepted it and returned a job id, because pg_cron stores the command as text
and never validates it. Both jobs showed active. Nine ticks fired and every one
came back 401, and none of that is visible from cron.job_run_details, which
said `succeeded` for all of them - pg_net is async, so `succeeded` only means
the POST was queued, never that it was answered.

THE ONLY HONEST CHECK IS net._http_response. status_code 401 nine times, then
200 from the moment the header was repaired. Read that table, not the cron log,
when asking whether a scheduled function is actually working.

The repair itself never touched the key: cron.alter_job with the new command
derived from the old one by regexp_replace, entirely server-side.

## Reopening the app resumes the rest-timer clock instead of losing it

Decided 2026-08-04.

Reported directly: "when I close the app, the clock doesn't continue." True,
and not a regression - restTimer/restLeft/restTotal in tiles/lifting.html have
always been plain in-memory JS vars with nothing reading them back on load, so
closing the app (or iOS evicting it) has always thrown the countdown away with
no trace it ever ran. Invisible before, because nowhere else held the real end
time. Now something does: scheduleRestPush() already stores an ABSOLUTE
fire_at in rest_timers. Reopening can read that back.

getActiveRestTimer() (lib/vault-remote.js) answers by ACCOUNT, not device - a
timer started on the phone with alerts on is just as real read from a browser
tab that has never turned them on. On tile boot, if the page view is open and
nothing is already counting down locally, it asks the host once, and if a
timer is still ahead of now it redraws the clock from actual elapsed time.

THREE THINGS KEPT IT FROM INVENTING A CLOCK:
- It never re-schedules. That row already exists; asking again would write a
  second one and could ring twice with unlucky timing. This only reads.
- An already-expired fire_at is not resumed. The push either already fired or
  is about to; showing "0:00, still counting" would be worse than nothing.
- A timer from long before (phone died, app not reopened until the next day)
  is capped at 20 minutes old. A countdown "still running" for eleven hours is
  not information.

Verified live rather than trusted from the source: mocked getActiveRestTimer
on the real page (not addInitScript, which vault-remote.js's own top-level
assignment would have clobbered - caught by the first version of the check
returning nothing and re-reading why), confirmed a ~90s-remaining timer resumes
showing 1:29 with a correctly proportioned bar, and confirmed an already-past
fire_at does not resume at all.

## Full audit, 2026-08-04. One real finding, and it was mine.

Swept the whole board: repo hygiene, XSS, sealed-iframe boundaries, secret
handling, registry-vs-files, store-shape docs vs code, weights.ts vs rank.js,
dead code from this session's refactors, and accessibility on the newest UI
(body map, calendar, routine reordering). Full method and result of each pass
is in the conversation this was done in; the one finding worth a permanent
record is here.

THE VAPID PRIVATE KEY WAS COMMITTED. tools/push.test.js's own secret-leak
check hardcoded the real key as the literal it searched for, in a file that
was itself committed and pushed twice (4a75ff9, a8d784f). The check's entire
purpose - proving the key never enters the repo - was undone by the way it was
written. The repo is private, which narrows this, but private is not the same
as safe: history on a pushed remote is not something deleting a line undoes.

Fixed here: the check now reads the key from .env.local at run time instead
of holding a copy of it, and skips (not fails) when .env.local is not present
- a fresh clone or CI has no local secret to check for, and that is a fact
about the machine, not a broken check.

NOT fixed here, and Ruben's call: the key already in git history. The honest
answer for a leaked credential, private repo or not, is to rotate it - a new
VAPID pair, a new Supabase secret, a new public key in lib/push.js - not to
rewrite history and hope. Rotating breaks every device already subscribed
until it re-enables alerts. Left for him to decide when.

Everything else came back clean: no stray files, no TODO/debugger/console.log
left in shipped code, no unescaped user input reaching innerHTML anywhere,
sandbox="allow-scripts" with no allow-same-origin on every tile, registry.js
lists exactly the six tile files that exist, lifting.html and lists.html's
declared store versions match their own migration code, weights.ts's three
goals average to exactly the WEIGHTS in rank.js (32/28/25/10/5), and a
heuristic dead-code sweep flagged sixteen "unused" functions that were all
false positives - passed as bare references to addEventListener, once(), or
.then(), never called with parens in the same file a naive grep would check.

SETUP.md had drifted: a "Not done yet" heading over three items already
checked off, and a description of run-tests.sh naming three suites when it
now runs fifteen plus three browser checks. Both corrected to say what is
actually there.

## The VAPID keys were rotated, and rotation is now one command

Rotated 2026-08-04, because the old private key was committed (see the audit
entry above). A leaked credential is not fixed by deleting the line that
leaked it - the old value is in history on a pushed remote, and the only
thing that actually ends its usefulness is making it worthless.

WHY ROTATE RATHER THAN REWRITE HISTORY. Rewriting would mean force-pushing a
rewritten master and hoping no clone, fork or cached view kept the old
objects. Rotation makes the exposed value inert whether or not anyone still
holds it, which is a guarantee rather than a hope. The old key stays in
history and no longer matters.

tools/new-vapid-keys.js does the whole rotation in one command, and does both
halves in one run ON PURPOSE. The pair only works as a pair: update the
private half in Supabase and forget the public half in lib/push.js and every
subscription is signed against a key the function cannot prove it owns, with
every push rejected and nothing on the client saying why. One command removes
the window where they can disagree. It also refuses to write anything if the
generated pair is malformed, and fails loudly if it cannot find the line in
lib/push.js to update, rather than leaving the two halves out of step.

THE PRIVATE KEY IS NEVER PRINTED, only written to .env.local. A key echoed to
a terminal lands in scrollback and in whatever is recording the session, which
is more copies than need to exist - the mistake that caused this rotation was
exactly one more copy than necessary.

The test changed too. It used to assert the public key by hardcoded literal,
which went stale the instant the keys rotated. It now checks SHAPE (87 chars,
uncompressed P-256 point) and AGREEMENT (lib/push.js matches .env.local),
which is the invariant that actually matters and survives every future
rotation.

WHAT ROTATION COSTS, and it is not nothing: every subscription created against
the old public key is dead. The rows in push_subscriptions can never receive
anything again and should be deleted, and every device has to turn rest timer
alerts off and on again. Deliberately NOT automated by adding 403 to the
function's GONE set - a genuinely misconfigured secret returns 403 too, and
treating that as "delete every subscription" would turn one bad deploy into
silently unsubscribing every device.

## The push function was 500ing on every tick, twice over

Found 2026-08-04, from net._http_response: 1439 responses, all 500, spanning
six hours - essentially every cron tick since deploy. cron.job_run_details said
succeeded throughout, for the reason already written above: pg_net is async and
"succeeded" only means the POST was queued.

The content column said nothing but "Internal Server Error". That bare string
is itself the clue - the function's own 500 path returns JSON, so a plain
string means the throw happened OUTSIDE any handler of ours and Deno answered
generically.

BUG ONE: VAPID KEYS ARE STORED AS BASE64URL AND IMPORTED AS JWK. Not the same
thing. importVapidKeys() hands its arguments straight to
crypto.importKey('jwk', ...), which needs a JsonWebKey object; it was being
given the base64url strings out of the environment. Verified rather than
guessed, against real WebCrypto: passing the strings throws
"2nd argument cannot be converted to a dictionary", and building proper JWKs
imports cleanly and round-trips a signature. The public key is the
uncompressed P-256 point (0x04, X, Y), so x and y are slices of it - and the
PRIVATE jwk needs x and y as well as d, which is easy to miss.

BUG TWO, and the reason it was 1439 and not a handful: the throw happened
BEFORE the loop that marks timers fired, so no due timer was ever marked and
every tick retried the same rows for ever. Fixed three ways - the whole handler
is wrapped so a throw returns a readable JSON body instead of a bare 500, the
query now has a lower bound (nothing more than an hour past due, since a rest
timer that late is worthless anyway), and prune_rest_timers deletes any old row
rather than only fired ones.

THE LESSON WORTH KEEPING: net._http_response.content is the first place to
look, and a bare "Internal Server Error" there means the failure is outside
your own error handling. Wrapping the handler so every failure answers with its
own message turns the next six-hour mystery into one query.

## The rest clock resumes whether or not notifications are on

Fixed 2026-08-04, after Ruben reported the timer "not going down" with the
phone locked.

FIRST, THE PART THAT IS NOT A BUG AND CANNOT BE FIXED: the on-screen countdown
stops when the phone locks. iOS suspends the page's JavaScript outright. No web
app keeps a live clock through a lock, and every design here has to start from
that. The notification is the answer to it.

THE ACTUAL BUG was in the second half. The rest_timers row does two separate
jobs: it is what the Edge Function pushes from, and it is the only record of
WHEN the timer ends, which is what lets the clock redraw correctly on reopening.
Only the first needs a push subscription. The host was gating the write on
VitalityPush.isEnabled(), so anyone who had not turned notifications on lost the
resume as well - and the only way to get the clock back was to accept
notifications they might not want. Two separate wants, coupled by accident.

The write is now attempted whenever there is a session. scheduleRestPush already
refuses when signed out, so a signed-out board writes nothing and behaves as it
always did. Rows written for a device with no subscription are harmless: the
function finds no subscriptions, sends nothing, marks the row fired, and prune
clears it.

The cost of the old behaviour was invisible in every test, because every test
asserted the gate was THERE. A test can only protect the behaviour someone
thought to want.

## Rest is two tiers now: five minutes multi-joint, three minutes floor

Set by Ruben, 2026-08-04. Nothing rests under three minutes, and anything
multi-joint rests five - he named the flat dumbbell press specifically, which
had been sitting on the middle tier as though it were a lesser press than the
barbell version when the demand is the same shape.

THE MIDDLE TIER IS GONE RATHER THAN RETUNED. It held "other multi-joint work" -
machine and dumbbell presses, pulldowns, rows, dips, lunges - and every one of
those is multi-joint, so under the new rule they all move up and the tier has
nothing left in it. Keeping an empty tier around would be a number nobody uses
and everybody has to reason about.

That collapse made four REST_OVERRIDE entries redundant in one stroke: Front
Squat, Romanian Deadlift, Incline Barbell Press and Pendlay Row were all
overrides onto the heavy tier from w:2, and w:2 now lands there on its own.
They were deleted rather than left agreeing with the rule, because an override
that agrees with the rule is a line somebody has to keep in step by hand for no
benefit. The test asserts every override actually changes the answer, which is
what catches the next set.

Push Up was ADDED as an override. It is w:1 - the rank maths does not rate a
bodyweight press highly - but it presses the same joints as a bench, and the
rule here is about what the movement asks of you rather than what it is worth
to a rank.

The whole library was printed and read, not spot-checked: 33 multi-joint at
5:00, 34 isolation at 3:00, nothing below the floor. Verified in a browser too,
because the tier only becomes real once the Rest button says it.

## Supersets and dropsets are a tag, not a second kind of set

Built 2026-08-04, the last item of the batch.

`grp: { id, kind }` marks which sets were done back to back. That is the whole
data change. A grouped set is still a set: setVolume, effLoad, e1rm, every
rank, every PR and the ledger read it exactly as before, because there is
nothing new for them to read. The alternative - a distinct shape for "a set,
but in a group" - would have meant teaching each of those about it, and each
one is a place to get it wrong. tiles/lifting.supersets.test.js computes the
same numbers grouped and ungrouped and asserts they are identical, so a future
special case fails there rather than quietly changing what a PR means.

NO SPECIAL CASE FOR A DROPSET'S LIGHTER DROPS. A PR is the heaviest single set
actually performed, so a drop loses to the top set on its own. The rule was
already right; it just needed leaving alone.

MID-GROUP THERE IS NO REST TIMER, and that is the feature rather than an
omission. A superset goes straight into the other exercise and a dropset
straight into the next drop; the rest is what comes after the whole thing. So
logging into an armed group skips startRest(), and ending the group starts it -
which is also the moment it was actually earned.

Arming tags the set ALREADY LOGGED as well, because a superset of one is not a
thing: the group is that set plus whatever comes next. Arming while the last
set is already grouped extends that group instead of stranding it in a group of
one and opening a second.

pendingGroup is session state and is never saved. What gets saved is the tag on
each set, which is a fact about the workout; "I am mid-superset right now" is a
fact about this minute. Reloading leaves the sets correctly tagged and simply
stops arming the next one.

RUNS FOLLOW ORDER, NOT JUST ID. Two sets sharing a grp.id with an unrelated set
between them are two runs, because that is what happened - drawing one block
round them would say they were done together. The log is append-only within a
session so the two normally agree; the display follows the order rather than
assuming it.

BY BODY PART DELIBERATELY DOES NOT DRAW GROUPS. A superset's two exercises land
in different muscle buckets, which is the honest answer to "what did my chest
do today" - drawing the group there would mean drawing half of it twice.

## The wearable pushes in. The tile never pulls

Started 2026-08-05, at Ruben's request: wear a ring or a watch, have Recovery
fill itself, and have the mentor read the result back as pointers.

THE DEVICE HE ACTUALLY HAS HAS NO API. It is an off brand ring plus a watch,
both driven by FitCloudPro (Hetang Smart). Their own SDK says the APPID and
APPKEY "have not been opened", so there are no developer credentials to apply
for, and the data never leaves the phone except over Bluetooth. There is no
server holding his nights that a scheduled job could ask. The GitHub Action
holding an API key, which `vault/chapter.md` named as the path for this, is
dead for this device. It stays correct for an Oura or a Whoop.

SO THE DIRECTION IS REVERSED. Nothing fetches. The phone, which already has the
data, pushes it: FitCloudPro to Apple Health, an iPhone Shortcut once a morning,
straight into Supabase. The board reads the vault it already reads. The tile
stays sealed, the repo holds no key, and the credential sits on the phone next
to the health data it is reading anyway.

APPLE HEALTH IS THE INTERFACE, NOT FITCLOUDPRO, and that is the decision that
makes this worth building at all. Ruben said outright that if the ring does not
sync he will buy an Apple Watch or another band. Reading Health rather than any
vendor means that swap costs nothing: the Shortcut, the function and the tile
all keep working. Nothing here is tied to one brand.

Whether the ring writes anything useful into Health was still unknown when this
was built. It had synced a night and Health showed nothing. That is a real
possibility this survives: the pipe is device agnostic on purpose.

A SECOND SLOT, NOT THE TILE'S OWN. `recovery:auto` sits beside `recovery` and
the automation never touches the first. The tile saves its slot wholesale on
every edit, so an automation writing the same slot would race a person typing
and silently destroy a morning they entered by hand, which is the house rule
this board does not break. Two slots also make "show both, you decide" possible,
which is the conflict behaviour Ruben chose over the watch winning or his
typing winning.

A FUNCTION, NOT A TABLE WRITE. `recovery_auto_upsert` merges one morning
server-side. A Shortcut POSTing the table directly would have to read the whole
slot, merge and write it back, so any hiccup between those steps loses every
morning it held. Merging one day at a time means the worst case is one morning
missing. It is SECURITY INVOKER, so RLS applies exactly as it does to the board
and there is no service-role key anywhere in this.

A NULL FIELD IS ABSENT, NEVER ZERO. Same law as the tile. A zero HRV would
poison the fourteen-day baseline the readiness band is built on, which is the
one number on this board most easily made to lie.

A PASSWORD, ON AN ACCOUNT THAT HAD NONE. Signing in here is a code in an email
and that has not changed for humans. An automation cannot read an inbox, and a
password grant is the only sign-in Supabase offers that a Shortcut can finish
alone. Refresh tokens rotate, so a stored one does not survive. The password
exists for the Shortcut, lives on the phone, and buys nothing an attacker could
not already do with that phone unlocked. `VitalityRemote.setPassword` sets it
from Ruben's own signed-in session, so no admin key is involved.

THE LEDGER IS NOT WRITTEN HERE, on purpose. `sleep_hours` is Recovery's one
reported number and the tile stays the only thing that reports it. Writing the
ledger from the inlet would be accepting the watch's figure on Ruben's behalf,
which is precisely the choice he asked to keep.

BUILT IN THE ORDER THAT FAILS HONESTLY: the vault side first, proven with a
deliberately fake number that gets deleted, then Health reading, then the tile.
Building the tile's "show both" face first would have meant shipping a UI for
data that may never arrive.
