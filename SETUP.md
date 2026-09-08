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

# Checking the board still works

`./run-tests.sh` runs everything: the rank maths, the shell panels, backups,
the icon set, Lifting's own suite (last-time, splits, unilateral, grouping,
suggestions, the body map, rest timing, routines, supersets, bodyweight sets),
Lists with its calendar and day view, Notes, the sealed-frame rules, the
rest-timer push wiring, and the reminder rules - whether one fires twice,
whether it fires the moment you save it, and what happens to 07:00 when the
clocks change. Plain node, no install, no framework. Run it before you push.

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
