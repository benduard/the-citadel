# Decisions

What you decided and why, so a future session never re-litigates it.

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
