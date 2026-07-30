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

## Supabase sync was wired up now, not left for a later episode

Decided 2026-07-29.

The seed ships expecting sync to arrive in a later episode, and the board to
run on device storage until then. Ruben asked for it early, after being told
plainly it meant building real sign in. It was built, audited, and the audit's
findings fixed.

Consequence to remember: data is per account now, not per browser. Signed out,
the board still runs on this device's local storage exactly as the seed did.
