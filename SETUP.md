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
Lists with its calendar and day view, Notes, the sealed-frame rules, and the
rest-timer push wiring. Plain node, no install, no framework. Run it before
you push.

If `tools/node_modules` is installed, it also runs five browser checks:
every tile actually paints (`visual-check.js`), nothing sits under the page's
close button at any width (`collision-check.js`), every control is big
enough to hit with a thumb (`touch-check.js`), every big number fits its
box and stays readable on a phone (`number-check.js`), and no text is
crushed into a vertical column of letters (`squeeze-check.js`).
