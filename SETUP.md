# My road to done

- [x] 1. The board, locally. serve it locally and see your name on it     REQUIRED
       your dashboard, running on this computer, with your name on it
- [x] 2. My name                                                      REQUIRED
       the greeting is yours. goals come later, with tiles
- [x] 3. GitHub. one browser sign in, the mentor does the git         RECOMMENDED
       your work is saved, and it is the door to going live
- [x] 4. Supabase. free project, run supabase/sync.sql               RECOMMENDED
       your vault tables, made and waiting
- [x] 5. Vercel. import the repo, hit deploy                          RECOMMENDED
       your dashboard live at your own URL. every push updates it
- [x] 6. Phone. open the live URL, Share, Add to Home Screen          OPTIONAL
       the dashboard as an app in your pocket

Done is 1 to 5. Six is a bonus. Tiles come after, one at a time, from a video.

---

# Sync, so the board follows you

Signed out, the board saves to this device only: localhost and your live URL
are two separate stores, and your phone starts empty. Sign in once per browser
and every tile's DATA reads and writes your Supabase vault instead, so the
same projects, logs and numbers show up everywhere.

What does NOT follow you yet: which tiles you have hidden or removed through
the Library. That layout still lives on each device, so a tile you hide on the
laptop is still on the phone. The data was the point; the layout is a later job.

- [x] Redirect URLs. Supabase, Authentication, URL Configuration
       add http://localhost:3000 and your live vercel.app URL, or the sign in
       link has nowhere to land
- [x] The account panel. the gear, then the account icon
       email in, then type the code it sends you. the code matters: added to an
       iPhone home screen, that icon is its own window, and a link tapped in
       Mail opens Safari instead, which can never sign the icon in
- [x] Your own email sender. Supabase, Project Settings, Authentication, SMTP
       Supabase's built in sender is capped at a few messages an hour, which
       runs out fast while testing. a free Resend account lifts it.
       CAUTION: Resend's no-domain sender (onboarding@resend.dev) will ONLY
       deliver to the email address on the Resend account itself. sign in with
       any other address and the mail is rejected and never arrives. a domain
       you own is the way past that. see vault/decisions.md
- [x] The email templates carry the code. Supabase, Authentication, Emails
       {{ .Token }} is in BOTH "Magic link or OTP" and "Confirm signup", because
       a first sign in and a returning one come from different templates
- [x] Re-run supabase/sync.sql. it is safe to run again
       adds label / kind / goal_direction / tile to the ledger, and the one row
       per key per day rule, so a reported number carries everything the tile
       said about it

---

# The equation, and the rank

- [x] The equation. Three goals are live in `lib/tiles/weights.ts`
       strong, feel, showup - each one weighting checkin/lifting/recovery/body/
       projects differently.
- [x] The rank. One standing across every log, Bronze to World Class
       `lib/rank.js`. Weights are your three goals averaged, since you said all
       three mattered. Half of it is showing up, half is improving on your own
       last fortnight. It refuses to rank under 28 days and counts down instead.
       Run `./run-tests.sh` to check the maths still holds.

---

# The rest alert, and the one step that breaks it

The alert now names the exact set and what it has to beat: "Barbell Bench
Press, set 4. Last time 100 kg x 8." That needs one new column in your
database, and the code shipped before the column did.

- [ ] Run `supabase/push.sql` again in the SQL editor
       safe to re-run, it only adds the `note` column. WITHOUT THIS you still
       get the alert, but the older, barer one: "Barbell Bench Press - back to
       it." Nothing is lost and nothing is broken, you just do not get the set
       number until this is run
- [ ] Redeploy the sender, so it reads that column
       `supabase functions deploy send-timer-push`

WHY THIS BIT YOU. For a while the board wrote the new column into a table that
did not have it yet, so the whole write was refused and no alert was scheduled
at all - while the countdown on screen kept running perfectly, which is what
made it look like notifications had broken rather than a column being missing.
Both ends now fall back to the older shape on their own, so the alert keeps
working whether or not the SQL has been run. Run it anyway, for the set number.

---

# The scale, so you stop typing your weight

Your VeSync scale already knows the number. This gets it to the Body tile
without the board ever holding a password to VeSync.

Nothing fetches. Your phone pushes: VeSync writes into Apple Health, and a
Shortcut hands one morning to your vault. If you swap the scale next year for
any other brand that writes to Health, none of this changes.

- [ ] Run `supabase/scale.sql` in the Supabase SQL editor
       makes `body_auto_upsert`. Safe to run again. Calling it by hand in the
       editor will say "not signed in" - that is it proving it is scoped to
       you, not a fault
- [ ] VeSync app, turn on Apple Health
       Profile, then Settings, then Connect to Apple Health. Allow WEIGHT to
       write. Step on the scale once and check the Health app shows it
- [ ] Set a password on your account, once
       a Shortcut cannot read the email code. The gear, then the account
       panel. This password exists for the Shortcut and lives on your phone -
       you still sign in with the emailed code yourself
- [ ] Build the Shortcut, and set it to run each morning
       Get Health Sample (Weight, latest) -> Get Contents of URL, POST to
       `https://<your-project>.supabase.co/rest/v1/rpc/body_auto_upsert`
       Headers: `apikey` and `Authorization: Bearer <token>`
       Body (JSON): `p_date` today as YYYY-MM-DD, `p_kg` the weight
       IN KILOGRAMS
- [ ] Weigh yourself, then open Body
       the morning shows up tagged `scale`

CAUTION, THE ONE WAY TO GET THIS WRONG: send kilograms. If your Health is set
to pounds, convert in the Shortcut before it sends. The function refuses
anything outside 20 to 400 so a pounds figure usually bounces, but it cannot
catch every case and a wrong unit in the trend is there for good.

A weight you typed yourself always wins. The scale only ever fills a morning
you left empty, and if both exist and disagree the tile shows you both and
changes nothing.

---

# Screen time, and the one honest thing to know first

Apple gives NOTHING away here. There is no API for Screen Time usage, for
anybody: the frameworks are native only, need Apple's permission, and put the
numbers inside a sealed view that even the app showing them cannot read. The
Shortcuts app has no action for it. So nothing can ask your iPhone what your
screen time was, and any app claiming to sync it is doing one of the two
things below.

The tile is on the board now and works today by typing the number in. The two
automatic paths are both optional and neither is magic.

## The Mac path. Apple's own numbers, automatically, about an hour behind

This is the good one. Screen Time syncs across your devices, and on a Mac that
lands in a database your own account can read.

- [ ] Both devices sharing. iPhone: Settings, Screen Time, Share Across
       Devices, on. Mac: System Settings, Screen Time, same switch. Same Apple
       ID on both. The first sync is not instant
- [ ] Run `supabase/screentime.sql` in the Supabase SQL editor
       makes `screentime_auto_upsert` and `screentime_app_event`. Safe to run
       again. Calling them by hand in the editor says "not signed in" - that
       is them proving they are scoped to you, not a fault
- [ ] On the Mac, give your terminal Full Disk Access
       System Settings, Privacy & Security, Full Disk Access, turn it on for
       Terminal. Then QUIT Terminal fully and reopen it. The switch does not
       apply to a window that was already open
- [ ] Find your iPhone in the database
       `./tools/screentime-export.sh --list-devices`. It prints every device
       syncing into it. Copy the id of the iPhone one
- [ ] Make the config file, `~/.citadel/screentime.env`
       the script prints the exact contents to make if it is not there. It
       needs your project URL, the anon key, your email, your account
       password, and that device id. `chmod 600` it
- [ ] Try it without sending anything
       `./tools/screentime-export.sh --dry-run`. It prints the day it read
- [ ] Send it for real, then open Screen time
       `./tools/screentime-export.sh`. The number shows up tagged as coming
       from Apple Screen Time via the Mac
- [ ] Optional, run it on its own. A `launchd` job or a cron line every hour:
       `0 * * * * /path/to/The\ Citadel/tools/screentime-export.sh >/dev/null`

IT IS NOT LIVE, and nothing will make it live. Apple syncs on its own
schedule, so expect anywhere from minutes to an hour behind, and expect today's
number to keep climbing each time it runs. The tile shows you when each number
arrived so you can always see how fresh it is.

The total will sit CLOSE TO but not exactly on what Settings shows. There is no
stored "your screen time was 4h 32m" row to copy - the script measures the
union of your app sessions, which is the honest version of the same question.
Treat it as your own consistent measure, not as a copy of Apple's headline.

WHAT IT DELIBERATELY DOES NOT SEND: pickups. That count is not in the database
and could only be guessed at. The tile has a box for it if you want to type it.

## The live path. Near real time, and only the apps you pick

iPhone Shortcuts can run something the moment an app opens or closes. That is
genuinely live, and it only ever sees apps you set up, so it is a floor on your
day rather than your day. The tile labels it that way and never files a partial
count as a real one.

Worth doing for the two or three apps you actually care about. Not worth doing
for forty.

- [ ] Set a password on your account, once, if you have not already
       a Shortcut cannot read the email code. The gear, then the account
       panel. Same password the scale Shortcut uses
- [ ] Shortcuts app, Automation tab, new automation, App
       pick one app, choose "Is Opened", and turn OFF "Ask Before Running"
- [ ] Add one action: Get Contents of URL
       POST to `https://<your-project>.supabase.co/rest/v1/rpc/screentime_app_event`
       Headers: `apikey` and `Authorization: Bearer <token>`
       Body (JSON): `p_app` the app's name, `p_event` the word `open`,
       `p_date` today as yyyy-MM-dd (Format Date, Custom)
- [ ] Duplicate it for "Is Closed", changing `p_event` to `close`
       both halves are needed. An open with no close is thrown away after
       twelve hours rather than counted as a twelve hour session

`p_date` is required and it is the PHONE's date. The server runs in UTC and
would otherwise file your evening under tomorrow.

## Which number wins

Three sources, and they are never added together, because they measure the same
hours rather than different ones:

1. Anything you TYPE wins, always. Nothing overwrites you.
2. Then the Mac's count, because it is Apple's own.
3. Then the live count, marked "so far".

The tile always says on screen which one you are looking at.

---

# Checking the board still works

`./run-tests.sh` runs everything: the rank maths, the shell panels, backups,
the icon set, Lifting's own suite (last-time, splits, unilateral, grouping,
suggestions, the body map, rest timing, routines, supersets, bodyweight sets),
Lists with its calendar and day view, Notes, Screen time, the sealed-frame
rules, the rest-timer push wiring, and the reminder rules - whether one fires
twice, whether it fires the moment you save it, and what happens to 07:00 when
the clocks change. Plain node, no install, no framework. Run it before you push.

Screen time's suite is worth knowing about, because the thing it guards is
invisible: a day can arrive from three places and they are never added
together. It pins that the Mac's count beats the live count without summing
them, that a typed day beats both, and that a partial live count never reaches
your ledger. It also pins that the rank reads a FALLING number as improving
here, which is the one place on this board where down is the good direction.

And `tools/screentime-merge.test.js` checks the export's arithmetic without
needing a Mac at all. It builds a fake Screen Time database, runs the REAL
query lifted straight out of `screentime-export.sh`, and proves that
overlapping app sessions are merged rather than added. That matters more than
it sounds: adding them up is the obvious thing to write, and it can report
thirty hours of screen time in a twenty-four hour day. On the test's own
fixture the naive version says 170 minutes where the truth is 110.

If `tools/node_modules` is installed, it also runs seven browser checks:
every tile actually paints (`visual-check.js`), nothing sits under the page's
close button at any width (`collision-check.js`), every control is big
enough to hit with a thumb (`touch-check.js`), every big number fits its
box and stays readable on a phone (`number-check.js`), no text is
crushed into a vertical column of letters (`squeeze-check.js`), no hint
or label is cut off mid-word by its own box (`clip-check.js`), and everything
the code hides is actually hidden (`hidden-check.js`).

Those seven need the board running: `npx --yes serve .` in one terminal, then
the checks in another. They are skipped, loudly, if the browser is not
installed - never silently.

---

# Reminders

Anything you want your phone to say, at a time you pick. It is the Reminders
tile plus two things that have to exist in your project, because a page cannot
wake a locked phone: something outside it has to send.

Notifications themselves are already wired - same permission, same subscription
and same service worker the rest timer uses. If rest alerts reach you, the
permission half is done and you can skip straight to the two steps below.

- [ ] Run `supabase/reminders.sql` in the Supabase SQL editor
       makes the `reminders` table with row level security on it. Safe to run
       again. Until this exists the tile SAYS so at the top of the page rather
       than looking healthy - your reminders are saved, they just cannot send
- [ ] Deploy the sender
       `supabase functions deploy send-reminder-push`. It uses the VAPID keys
       already in your project's secrets from the rest timer, so there is no
       new key to make
- [ ] Schedule it, every minute
       the two `cron.schedule` lines at the bottom of `supabase/reminders.sql`,
       with your project ref and service_role key filled in. Uncomment and run
       them AFTER the deploy above, or the first tick calls a URL that is not
       there yet
- [ ] Open Reminders and add one, then check the top of the page
       it says On, Signed out, or exactly which piece is missing. It never
       says On unless it is

WHAT IT WILL NOT DO, on purpose: it never invents the words. The notification
says the title and line you typed and nothing else. And "keep it on screen
until I tap it" is honoured by Android and largely ignored by iPhone, which
the tile tells you next to the switch rather than quietly failing.

A reminder is a rule, not an alarm clock: 07:00 plus your timezone, so it stays
07:00 through a clock change and in another country. Nothing here reports a
number to your vault - a reminder arriving is the phone doing something, not
you.
