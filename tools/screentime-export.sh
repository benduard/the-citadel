#!/bin/sh
# THE SCREEN TIME EXPORT. Runs on a Mac. Reads the Screen Time database Apple
# already keeps on disk and hands one day to your vault.
#
# RUN IT:   ./tools/screentime-export.sh                 today
#           ./tools/screentime-export.sh --days 7        today and the 6 before
#           ./tools/screentime-export.sh --date 2026-09-05
#           ./tools/screentime-export.sh --list-devices  which devices are syncing
#           ./tools/screentime-export.sh --dry-run       print, send nothing
#
#
# ── WHY THIS EXISTS AND WHY IT IS THE ONLY WAY ────────────────────────────────
#
# Apple publishes NO API for Screen Time usage. DeviceActivity and
# FamilyControls are native only, need an entitlement, and render inside a
# privacy extension that cannot talk to the network and whose numbers the host
# app cannot read. Shortcuts has no action for it. So nothing can ask an iPhone
# what its screen time was.
#
# What DOES exist: with Screen Time > "Share Across Devices" turned on, your
# iPhone's usage rows sync to every device on the same Apple ID, and on a Mac
# they land in a plain SQLite file that your own user account can read. That is
# what this reads. Apple's own numbers, off your own disk, no key to anyone.
#
# IT IS NOT LIVE. Apple syncs that database on its own schedule - expect
# minutes to about an hour of lag, and expect today's number to keep climbing
# every time you run this. If you want something closer to live, that is the
# app-automation half in supabase/screentime.sql, and it is an approximation of
# a different kind. Neither one is a live feed, because there is no such thing.
#
#
# ── WHAT IT DOES NOT SEND, ON PURPOSE ─────────────────────────────────────────
#
# PICKUPS. Screen Time's pickup count is not a column in this database. It
# could be approximated by counting display-wake events, and that approximation
# would be wrong in ways nobody could see afterwards. The house rule is show
# less and never lie, so this sends no pickup count at all. Type it in the tile
# if you want it: the tile has a box for exactly that.
#
# THE TOTAL IS COMPUTED, NOT COPIED. There is no stored "your screen time was
# 4h 32m" row either. This merges the overlapping app-usage intervals for the
# day and measures the union, which is the honest definition of time spent with
# an app in front of you. It will sit CLOSE TO but not exactly on what Settings
# shows, because Apple counts some things this cannot see. Treat it as your own
# consistent measure, not as a copy of Apple's headline figure.


set -e

# ── Where the numbers live. Both paths are checked: Apple has moved this file
#    between macOS versions, and a script that only knows one of them fails
#    with "no database" on a Mac that has the data sitting right there.
DB_CANDIDATES="$HOME/Library/Application Support/Knowledge/knowledgeC.db
$HOME/Library/Application Support/CoreDuet/Knowledge/knowledgeC.db"

# ── Your project and your account. Keep this OUT of the repo. Chmod 600 it.
CONF="${CITADEL_CONF:-$HOME/.citadel/screentime.env}"

DAY=""
DAYS=1
LIST_DEVICES=0
DRY=0

while [ $# -gt 0 ]; do
  case "$1" in
    --date)         DAY="$2"; shift 2 ;;
    --days)         DAYS="$2"; shift 2 ;;
    --list-devices) LIST_DEVICES=1; shift ;;
    --dry-run)      DRY=1; shift ;;
    -h|--help)      sed -n '2,60p' "$0"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

# ── 1. Find the database, and say something useful when it cannot be read.
DB=""
OLDIFS="$IFS"; IFS="
"
for c in $DB_CANDIDATES; do
  if [ -f "$c" ]; then DB="$c"; break; fi
done
IFS="$OLDIFS"

if [ -z "$DB" ]; then
  echo "No Screen Time database found. Looked in:" >&2
  echo "$DB_CANDIDATES" | sed 's/^/  /' >&2
  echo "" >&2
  echo "This script only runs on a Mac. There is no equivalent file on Windows," >&2
  echo "and no way to reach the iPhone's copy directly." >&2
  exit 1
fi

# READING IT NEEDS FULL DISK ACCESS. The file exists and is owned by you, and
# macOS still refuses the read unless the app running this is on the list.
# The error macOS gives is "unable to open database file", which reads like a
# missing file rather than a permission, so it is worth naming outright.
if ! sqlite3 "$DB" "select 1;" >/dev/null 2>&1; then
  echo "Found the database but macOS will not let this read it:" >&2
  echo "  $DB" >&2
  echo "" >&2
  echo "Give your terminal Full Disk Access, then run this again:" >&2
  echo "  System Settings > Privacy & Security > Full Disk Access" >&2
  echo "  turn it on for Terminal (or iTerm, or whichever you are in)" >&2
  echo "  then QUIT that app fully and reopen it. The switch does not" >&2
  echo "  take effect in a window that was already open." >&2
  exit 1
fi

# ── 2. Work on a copy, never the live file.
#
# It is an active SQLite database with a write-ahead log, and another process
# is writing to it constantly. Querying it in place can block, can read a torn
# page, and in the worst case can leave a lock behind on a file the OS depends
# on. The -wal and -shm files come too, or the copy is missing everything
# written since the last checkpoint - which on a busy database is most of today.
TMP="$(mktemp -d "${TMPDIR:-/tmp}/citadel-st.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT INT TERM
cp "$DB" "$TMP/k.db" 2>/dev/null || { echo "could not copy the database" >&2; exit 1; }
[ -f "$DB-wal" ] && cp "$DB-wal" "$TMP/k.db-wal" 2>/dev/null || true
[ -f "$DB-shm" ] && cp "$DB-shm" "$TMP/k.db-shm" 2>/dev/null || true
COPY="$TMP/k.db"

# Apple stores timestamps as seconds since 2001-01-01, not 1970. Everything
# below adds this before treating a number as a unix time.
COCOA=978307200

# ── 3. Which devices are in there.
#
# The Mac's own usage is in this file too, and it is NOT what you asked for. A
# script that summed everything would quietly report your laptop's hours as
# your phone's. So the device is chosen, never assumed.
list_devices() {
  sqlite3 -separator '  ' "$COPY" "
    select
      coalesce(s.ZDEVICEID, 'this-mac')                as device,
      coalesce(p.ZMODEL, p.ZNAME, 'this Mac')          as model,
      count(*)                                         as rows_,
      date(max(o.ZSTARTDATE) + $COCOA, 'unixepoch', 'localtime') as last_seen
    from ZOBJECT o
    left join ZSOURCE   s on s.Z_PK = o.ZSOURCE
    left join ZSYNCPEER p on p.ZDEVICEID = s.ZDEVICEID
    where o.ZSTREAMNAME = '/app/usage'
    group by device, model
    order by rows_ desc;
  " 2>/dev/null
}

if [ "$LIST_DEVICES" = "1" ]; then
  echo "Devices with app usage in this database:"
  echo ""
  printf '  %-38s %-22s %8s  %s\n' DEVICE MODEL ROWS "LAST SEEN"
  list_devices | while IFS='  ' read -r d m r l; do
    printf '  %-38s %-22s %8s  %s\n' "$d" "$m" "$r" "$l"
  done
  echo ""
  echo "Put the one that is your iPhone in $CONF as:"
  echo "  CITADEL_DEVICE_ID=<the device column>"
  echo ""
  echo "If only 'this-mac' is listed, the iPhone is not syncing yet. On the"
  echo "phone: Settings > Screen Time > Share Across Devices, on. On this Mac:"
  echo "System Settings > Screen Time > Share Across Devices, on. Both must be"
  echo "the same Apple ID, and the first sync is not instant."
  exit 0
fi

# ── 4. Config.
if [ ! -f "$CONF" ]; then
  cat >&2 <<CONFHELP
No config at $CONF

Make it, with your own values, then chmod 600 it:

  mkdir -p "$(dirname "$CONF")"
  cat > "$CONF" <<'EOF'
  CITADEL_URL=https://YOURPROJECT.supabase.co
  CITADEL_ANON_KEY=eyJ...            # the anon key, same one in lib/supabase-config.js
  CITADEL_EMAIL=you@example.com
  CITADEL_PASSWORD=the password you set on your account
  CITADEL_DEVICE_ID=                 # from --list-devices. blank = this Mac only
EOF
  chmod 600 "$CONF"

The password is the one from the account panel, the same one the scale
Shortcut uses. A script cannot read the emailed code, which is why it exists.
CONFHELP
  exit 1
fi

# shellcheck disable=SC1090
. "$CONF"

if [ -z "$CITADEL_URL" ] || [ -z "$CITADEL_ANON_KEY" ] || [ -z "$CITADEL_EMAIL" ] || [ -z "$CITADEL_PASSWORD" ]; then
  echo "$CONF is missing one of CITADEL_URL, CITADEL_ANON_KEY, CITADEL_EMAIL, CITADEL_PASSWORD" >&2
  exit 1
fi

if [ -n "$CITADEL_DEVICE_ID" ]; then
  DEVICE_SQL="and s.ZDEVICEID = '$(printf '%s' "$CITADEL_DEVICE_ID" | sed "s/'/''/g")'"
  DEVICE_LABEL="$CITADEL_DEVICE_ID"
else
  # No device set means this Mac's own rows, which have no ZSOURCE device id.
  # Said out loud on every run, because silently reporting the laptop as the
  # phone is the single most likely way to end up with months of wrong numbers.
  DEVICE_SQL="and s.ZDEVICEID is null"
  DEVICE_LABEL="this Mac (no CITADEL_DEVICE_ID set)"
fi

# ── 5. A readable name for a bundle id.
#
# The database stores bundle ids and nothing else - there is no display name in
# it, and for an iPhone-only app this Mac has never seen there is nowhere to
# look one up. So: a short list of the obvious ones, and the RAW BUNDLE ID for
# everything else. An unrecognised app shows as com.whatever.thing, which is
# ugly and true, rather than a prettified guess that might name the wrong app.
pretty() {
  case "$1" in
    com.apple.mobilesafari|com.apple.Safari)  echo "Safari" ;;
    com.google.ios.youtube)                   echo "YouTube" ;;
    com.burbn.instagram)                      echo "Instagram" ;;
    com.zhiliaoapp.musically)                 echo "TikTok" ;;
    com.facebook.Facebook)                    echo "Facebook" ;;
    net.whatsapp.WhatsApp)                    echo "WhatsApp" ;;
    ph.telegra.Telegraph)                     echo "Telegram" ;;
    com.atebits.Tweetie2)                     echo "X" ;;
    com.reddit.Reddit)                        echo "Reddit" ;;
    com.hammerandchisel.discord)              echo "Discord" ;;
    com.spotify.client)                       echo "Spotify" ;;
    com.netflix.Netflix)                      echo "Netflix" ;;
    com.apple.MobileSMS)                      echo "Messages" ;;
    com.apple.mobilemail|com.apple.mail)      echo "Mail" ;;
    com.apple.mobilephone)                    echo "Phone" ;;
    com.apple.Music|com.apple.MobileMusic)    echo "Music" ;;
    com.apple.mobileslideshow)                echo "Photos" ;;
    com.google.Chrome|com.google.chrome.ios)  echo "Chrome" ;;
    com.openai.chat)                          echo "ChatGPT" ;;
    com.linkedin.LinkedIn)                    echo "LinkedIn" ;;
    *)                                        echo "$1" ;;
  esac
}

# JSON has no escaping story here because it never needs one: bundle ids and
# the names above are letters, digits, dots and hyphens. Anything else is
# stripped rather than escaped, so a strange row can never break the payload.
safe() { printf '%s' "$1" | tr -cd 'A-Za-z0-9 ._-'; }

# ── 6. The day's numbers.
#
# GAPS AND ISLANDS. Raw rows overlap: two /app/usage rows for the same app can
# cover the same seconds, and different apps certainly do. Summing durations
# would report more hours than the day contains - it is entirely possible to
# get 30 hours out of a 24 hour day that way. So overlapping intervals are
# merged into islands first and the islands are measured. Per app for the
# breakdown, and once across everything for the total.
#
# EVERY INTERVAL IS CLAMPED TO THE DAY. A session running from 23:40 to 00:20
# contributes 20 minutes to one day and 20 to the next, rather than 40 to
# whichever end it is filed under.
day_query() {
  d="$1"
  scope="$2"   # 'app' or 'all'
  part=""
  sel="'total'"
  if [ "$scope" = "app" ]; then
    part="partition by app"
    sel="app"
  fi
  sqlite3 -separator '|' "$COPY" "
    with bounds as (
      select strftime('%s', '$d 00:00:00', 'utc') + 0 as d0,
             strftime('%s', '$d 00:00:00', 'utc') + 86400 as d1
    ),
    u as (
      select
        o.ZVALUESTRING as app,
        max(o.ZSTARTDATE + $COCOA, (select d0 from bounds)) as s,
        min(o.ZENDDATE   + $COCOA, (select d1 from bounds)) as e
      from ZOBJECT o
      left join ZSOURCE s on s.Z_PK = o.ZSOURCE
      where o.ZSTREAMNAME = '/app/usage'
        and o.ZVALUESTRING is not null and o.ZVALUESTRING <> ''
        and o.ZENDDATE > o.ZSTARTDATE
        and o.ZSTARTDATE + $COCOA < (select d1 from bounds)
        and o.ZENDDATE   + $COCOA > (select d0 from bounds)
        $DEVICE_SQL
    ),
    ordered as (
      select $sel as k, s, e,
             max(e) over ($part order by s rows between unbounded preceding and 1 preceding) as prev_max
      from u
    ),
    marked as (
      select k, s, e, case when prev_max is null or s > prev_max then 1 else 0 end as is_start
      from ordered
    ),
    grp as (
      select k, s, e, sum(is_start) over (partition by k order by s rows unbounded preceding) as g
      from marked
    ),
    islands as (
      select k, min(s) as gs, max(e) as ge from grp group by k, g
    )
    select k, cast(round(sum(ge - gs) / 60.0) as integer) as mins
    from islands
    group by k
    having mins > 0
    order by mins desc;
  " 2>/dev/null
}

# strftime with 'utc' above converts a LOCAL midnight to a unix second. The
# rows are unix seconds, so both sides are in the same units and the day
# boundary is the one the phone actually experienced.

# ── 7. Sign in once, reuse the token for every day in the run.
TOKEN=""
sign_in() {
  resp=$(curl -s -X POST "$CITADEL_URL/auth/v1/token?grant_type=password" \
    -H "apikey: $CITADEL_ANON_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$CITADEL_EMAIL\",\"password\":\"$CITADEL_PASSWORD\"}")
  TOKEN=$(printf '%s' "$resp" | sed -n 's/.*"access_token":"\([^"]*\)".*/\1/p')
  if [ -z "$TOKEN" ]; then
    echo "Could not sign in. Supabase said:" >&2
    printf '%s\n' "$resp" >&2
    echo "" >&2
    echo "If it says 'Invalid login credentials', set a password on your" >&2
    echo "account first: the board, the gear, then the account panel." >&2
    exit 1
  fi
}

send_day() {
  d="$1"; total="$2"; apps_json="$3"
  body="{\"p_date\":\"$d\",\"p_minutes\":$total,\"p_apps\":$apps_json,\"p_src\":\"mac-knowledgec\"}"
  resp=$(curl -s -X POST "$CITADEL_URL/rest/v1/rpc/screentime_auto_upsert" \
    -H "apikey: $CITADEL_ANON_KEY" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "$body")
  case "$resp" in
    *'"ok":true'*|*'"ok": true'*) echo "  sent" ;;
    *) echo "  NOT SENT: $resp" >&2; return 1 ;;
  esac
}

# ── 8. Run it.
if [ -z "$DAY" ]; then DAY=$(date '+%Y-%m-%d'); fi
case "$DAY" in
  [0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]) ;;
  *) echo "--date wants YYYY-MM-DD, got: $DAY" >&2; exit 2 ;;
esac

echo "Screen time export"
echo "  database  $DB"
echo "  device    $DEVICE_LABEL"
echo ""

[ "$DRY" = "1" ] || sign_in

i=0
sent=0
while [ "$i" -lt "$DAYS" ]; do
  # BSD date, which is what macOS has. NOT silently falling back to $DAY on
  # failure: that would make `--days 7` send the same day seven times and
  # report seven successes, which looks exactly like a working backfill.
  d=$(date -j -v-"${i}"d -f '%Y-%m-%d' "$DAY" '+%Y-%m-%d' 2>/dev/null)
  if [ -z "$d" ]; then
    echo "could not step back $i day(s) from $DAY with this date command" >&2
    exit 1
  fi
  i=$((i + 1))

  total=$(day_query "$d" all | cut -d'|' -f2)
  [ -z "$total" ] && total=0

  # Nothing measured is NOT a zero day. It means the sync has not brought that
  # day over, or the device filter is wrong, or you genuinely did not have the
  # phone. Sending a 0 would file "no screen time at all" as a fact, and the
  # tile would draw it as a real bar. Skip it and say so.
  if [ "$total" -le 0 ]; then
    echo "$d  nothing measured, skipped"
    continue
  fi

  # Only apps worth a line. A 12 second background wake is not "time on an
  # app" and twenty of them would bury the six that matter.
  named=""
  for row in $(day_query "$d" app | awk -F'|' '$2 >= 1 {print $1 "|" $2}'); do
    bid=${row%%|*}
    mins=${row##*|}
    name=$(safe "$(pretty "$bid")")
    [ -z "$name" ] && continue
    named="$named$name|$mins
"
  done

  # SUMMED BY NAME, not just concatenated. Two bundle ids can map to one name -
  # com.apple.mobilesafari and com.apple.Safari both become "Safari" - and a
  # JSON object with the same key twice silently keeps only the last one, so
  # the other app's minutes would vanish with nothing to show it happened.
  # Rare while the device filter is set, and a silent data loss either way.
  apps_json=$(printf '%s' "$named" | awk -F'|' 'NF==2 { a[$1] += $2 } END {
      s = "{"; first = 1
      for (k in a) { if (!first) s = s ","; s = s "\"" k "\":" a[k]; first = 0 }
      print s "}"
    }')
  [ -z "$apps_json" ] && apps_json="{}"

  h=$((total / 60)); m=$((total % 60))
  echo "$d  ${h}h ${m}m"

  if [ "$DRY" = "1" ]; then
    echo "  would send: $apps_json"
  else
    send_day "$d" "$total" "$apps_json" && sent=$((sent + 1))
  fi
done

echo ""
if [ "$DRY" = "1" ]; then
  echo "Dry run. Nothing was sent."
else
  echo "$sent day(s) sent. Open the Screen time tile."
fi
