/**
 * Rest-timer push. Plain node: `node tools/push.test.js`.
 *
 * End-to-end delivery cannot be tested here - it needs a real push service and
 * a real locked phone. What CAN be pinned is everything that decides whether a
 * notification is sent twice, never, or forever:
 *
 *   - which timers the function picks up (due, unfired, not future)
 *   - that a row is marked fired even when every device fails, or the same
 *     timer is retried every 15 seconds until the end of time
 *   - that a dead subscription is deleted rather than retried
 *   - that the private key never reaches the repo
 *
 * The selection logic is re-implemented here against the same rules the Edge
 * Function states, and the function's source is asserted to still contain
 * those rules - so this fails if someone loosens the query.
 */
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const fn = fs.readFileSync(path.join(ROOT, 'supabase/functions/send-timer-push/index.ts'), 'utf8')
const sql = fs.readFileSync(path.join(ROOT, 'supabase/push.sql'), 'utf8')
const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8')
const push = fs.readFileSync(path.join(ROOT, 'lib/push.js'), 'utf8')
const host = fs.readFileSync(path.join(ROOT, 'lib/tiles/host.js'), 'utf8')
const lifting = fs.readFileSync(path.join(ROOT, 'tiles/lifting.html'), 'utf8')
const remote = fs.readFileSync(path.join(ROOT, 'lib/vault-remote.js'), 'utf8')

let fails = 0
const check = (label, cond, extra) => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${cond || extra === undefined ? '' : '  -> ' + extra}`)
  if (!cond) fails++
}

// Checks that need real async crypto push their promise here; the exit code is
// held until they all settle, or the process would report success before they
// had run.
const deferred = []

// The key material, read once. .env.local is gitignored and simply absent on a
// fresh clone, which is a fact about the machine and not a failure - the checks
// that need it are skipped rather than failed. THE PRIVATE KEY IS NEVER A
// LITERAL IN THIS FILE: an earlier version hardcoded it to prove it was absent
// from committed files, which put it in one.
const envLocalPath = path.join(ROOT, '.env.local')
const envLocal = fs.existsSync(envLocalPath) ? fs.readFileSync(envLocalPath, 'utf8') : ''
const privMatch = envLocal.match(/^VAPID_PRIVATE_KEY=(\S+)/m)
const pagePub = (push.match(/var VAPID_PUBLIC = '([^']+)'/) || [])[1]

// The rule the function implements: fired = false AND fire_at <= now.
const due = (rows, now) => rows.filter(r => r.fired === false && new Date(r.fire_at) <= now)

// ---------------------------------------------------------------------------
console.log('\n[1] which timers get picked up')
const NOW = new Date('2026-08-03T12:00:00Z')
const rows = [
  { id: 1, fired: false, fire_at: '2026-08-03T11:59:00Z' },  // due
  { id: 2, fired: false, fire_at: '2026-08-03T12:00:00Z' },  // due, exactly now
  { id: 3, fired: false, fire_at: '2026-08-03T12:00:30Z' },  // not yet
  { id: 4, fired: true,  fire_at: '2026-08-03T11:00:00Z' },  // already sent
  { id: 5, fired: false, fire_at: '2026-08-03T09:00:00Z' }   // missed while down
]
const picked = due(rows, NOW).map(r => r.id).sort()
check('a timer whose moment has passed is picked', picked.includes(1))
check('a timer due exactly now is picked', picked.includes(2))
check('a FUTURE timer is not picked', !picked.includes(3), String(picked))
check('an already-fired timer is never picked again', !picked.includes(4))
check('a timer missed while the function was down still fires', picked.includes(5))
check('nothing else came along', picked.join() === '1,2,5', picked.join())

console.log('\n[2] the function actually queries by those rules')
check('filters on fired = false', /\.eq\('fired', false\)/.test(fn))
check('filters on fire_at <= now', /\.lte\('fire_at', new Date\(now\)\.toISOString\(\)\)/.test(fn))
check('takes the oldest first, so a backlog drains in order',
  /\.order\('fire_at', \{ ascending: true \}\)/.test(fn))
check('bounded, so one bad batch cannot run forever', /\.limit\(\d+\)/.test(fn))

// ---------------------------------------------------------------------------
console.log('\n[3] a timer is marked fired exactly once, come what may')
check('the update sets fired true', /update\(\{ fired: true \}\)/.test(fn))
check('it targets that one row by id', /update\(\{ fired: true \}\)\.eq\('id', t\.id\)/.test(fn))
// The trap: marking fired only on success means a broken subscription makes
// the same timer retry every 15s for ever.
const markBlock = fn.slice(fn.indexOf('for (const t of timers)'))
const updateIdx = markBlock.indexOf("update({ fired: true })")
const loopEnd = markBlock.indexOf('return new Response')
check('marking happens per timer, outside the per-device try/catch',
  updateIdx > 0 && updateIdx < loopEnd)
check('and the code says why, so nobody "fixes" it into a retry loop',
  /whether or not a device took it/i.test(fn))

// ---------------------------------------------------------------------------
// Both of these shipped broken and cost 1439 consecutive failed pushes over
// six hours. Neither announced itself: Deno answers an uncaught throw with a
// bare 500 "Internal Server Error", so net._http_response showed nothing but
// the status code.
console.log('\n[3b] VAPID keys are converted to JWK, not passed as base64url strings')
check('there is a converter at all', /function vapidJwks\(/.test(fn))
check('importVapidKeys is given the CONVERTED keys, never the raw env strings',
  /importVapidKeys\(\s*vapidJwks\(VAPID_PUBLIC, VAPID_PRIVATE\)/.test(fn))
check('the raw strings are never handed straight to importVapidKeys',
  !/importVapidKeys\(\s*\{ publicKey: VAPID_PUBLIC/.test(fn))
check('x and y are sliced out of the 65-byte uncompressed point',
  /raw\.subarray\(1, 33\)/.test(fn) && /raw\.subarray\(33, 65\)/.test(fn))
check('the PRIVATE jwk carries x and y too, not only d - importKey rejects it otherwise',
  /privateKey: \{ kty: 'EC', crv: 'P-256', x, y, d: priv/.test(fn))
check('a malformed public key fails loudly, with the actual length in the message',
  /is not an uncompressed P-256 point \(got \$\{raw\.length\} bytes/.test(fn))

// Prove the conversion against real WebCrypto rather than trusting the shape.
// This is the check that would have caught the original bug.
const { webcrypto } = require('crypto')
if (privMatch) {
  const ALGO = { name: 'ECDSA', namedCurve: 'P-256' }
  const toBytes = s => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
  const toB64u = b => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  const rawPt = toBytes(pagePub)
  const jwkX = toB64u(rawPt.subarray(1, 33))
  const jwkY = toB64u(rawPt.subarray(33, 65))
  const pending = webcrypto.subtle
    .importKey('jwk', { kty: 'EC', crv: 'P-256', x: jwkX, y: jwkY, ext: true }, ALGO, true, ['verify'])
    .then(pk => webcrypto.subtle
      .importKey('jwk', { kty: 'EC', crv: 'P-256', x: jwkX, y: jwkY, d: privMatch[1], ext: true }, ALGO, false, ['sign'])
      .then(sk => webcrypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, sk, new TextEncoder().encode('citadel'))
        .then(sig => webcrypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pk, sig, new TextEncoder().encode('citadel')))))
    .then(ok => { check('the real key pair imports as JWK and signs/verifies together', ok === true) })
    .catch(e => { check('the real key pair imports as JWK and signs/verifies together', false, e.message) })
  deferred.push(pending)
}

console.log('\n[3d] the Edge Function is at least syntactically valid')
// Nothing in this repo compiles the function - there is no build step - so a
// stray bracket only surfaces at `supabase functions deploy`, as a bundler
// error, minutes later. That happened: splitting the handler into
// Deno.serve(...) + handle() left the original `})` closing a function that
// no longer took a callback, and it shipped as far as the deploy.
//
// Balanced delimiters, counted outside strings, comments and template
// literals. Not a type check - just the class of error that actually got out.
// Parsed by a REAL parser, not a hand-rolled bracket counter. The first
// version of this check was that counter, and it reported an imbalance in a
// file that parses perfectly - a check that cries wolf on correct code is
// worse than no check, because the next person learns to ignore it.
//
// The type annotations are stripped first, approximately. That is the honest
// limitation: this proves the SHAPE is valid JavaScript, not that the types
// are right. Its failure mode is a false alarm on some future annotation the
// stripper does not know, which is loud and gets fixed - not silence.
{
  const stripped = fn
    .replace(/^import .*$/gm, '')
    .replace(/: Promise<Response>/g, '')
    .replace(/: (Uint8Array|string|number|boolean)\b/g, '')
    .replace(/\bas \{[^}]*\}/g, '')
    .replace(/\(e as [^)]*\)/g, '(e)')
    .replace(/Deno\.env\.get\(([^)]*)\)!/g, 'Deno.env.get($1)')
  let parseErr = null
  try { new Function(stripped) } catch (e) { parseErr = e.message }
  check('it parses as valid JavaScript', parseErr === null, parseErr)
}
check('the handler is a named function, and Deno.serve only wraps it',
  /Deno\.serve\(async \(\) => \{/.test(fn) && /^async function handle\(\)/m.test(fn))

console.log('\n[3c] a timer can never be retried for ever')
check('the query has a lower bound, not just "anything due"', /\.gte\('fire_at'/.test(fn))
check('the staleness cutoff is named, not a magic number', /STALE_AFTER_MS/.test(fn))
check('the whole handler is wrapped, so a throw returns a readable body not a bare 500',
  /try \{\s*\n\s*return await handle\(\)/.test(fn) &&
  /ok: false, error: message/.test(fn))
check('prune clears rows that can never be sent, not only fired ones',
  /delete from rest_timers where fire_at < now\(\) - interval '1 day'/.test(sql))

console.log('\n[4] a dead subscription is deleted, not retried for ever')
check('404 and 410 are treated as gone', /GONE = new Set\(\[404, 410\]\)/.test(fn))
check('and the row is deleted when they come back',
  /delete\(\)\.eq\('endpoint', s\.endpoint\)/.test(fn))
check('any other failure is logged, not swallowed silently', /console\.error\('push failed for'/.test(fn))

// ---------------------------------------------------------------------------
console.log('\n[5] the schema can hold what the function reads')
check('push_subscriptions exists', /create table if not exists push_subscriptions/.test(sql))
check('endpoint is the key, so re-subscribing updates instead of duplicating',
  /endpoint\s+text primary key/.test(sql))
check('rest_timers exists', /create table if not exists rest_timers/.test(sql))
check('both tables have RLS enabled',
  /alter table push_subscriptions enable row level security/.test(sql) &&
  /alter table rest_timers enable row level security/.test(sql))
check('both are scoped to the signed-in user, same as sync.sql',
  (sql.match(/auth\.uid\(\) = user_id/g) || []).length >= 4)
check('and granted, or RLS never even evaluates',
  /grant .* on push_subscriptions to authenticated/.test(sql) &&
  /grant .* on rest_timers to authenticated/.test(sql))
check('the due-timer index matches the query it exists for',
  /on rest_timers \(fire_at\) where fired = false/.test(sql))
check('fired rows are pruned, so the table does not grow for ever',
  /function prune_rest_timers/.test(sql))

console.log('\n[6] the cron statements are commented out until the function exists')
check('the schedule is left commented, not armed on first run',
  /^-- select cron\.schedule\(/m.test(sql))
check('and it says to deploy the function first',
  /AFTER deploying the send-timer-push function/.test(sql))
check('15 second cadence, with the reason stated', /15 seconds/.test(sql))

// ---------------------------------------------------------------------------
console.log('\n[7] THE SECRET NEVER ENTERS THE REPO')
// THE PRIVATE KEY IS DELIBERATELY NOT A LITERAL IN THIS FILE. A version of
// this check once hardcoded the real value to search for it, which defeats
// the entire point: verifying a secret is absent by writing it into a
// tracked, committed test file puts it in the repo anyway. Read it from
// .env.local instead - gitignored, present locally, and simply skipped (not
// failed) on a machine that has never had it, e.g. a fresh clone or CI.
// (envLocal / privMatch / pagePub are read once at the top of this file.)
if (privMatch) {
  const PRIVATE = privMatch[1]
  const tracked = [fn, sql, sw, push, host, lifting, remote,
    fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')]
  check('the private key is in no committed file',
    tracked.every(f => f.indexOf(PRIVATE) === -1))
} else {
  console.log('  SKIP  no .env.local here, so there is no local private key to check for - not a failure')
}
check('the function reads it from the environment only',
  /Deno\.env\.get\('VAPID_PRIVATE_KEY'\)/.test(fn))
check('.env.local is gitignored',
  /^\.env\.\*$/m.test(fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8')))
// The PUBLIC key belongs in the page - the browser hands it to the push
// service at subscribe time. Asserted by SHAPE and by AGREEMENT rather than
// against a hardcoded value: a literal here goes stale the moment the keys
// are rotated, which is exactly what happened the first time they were.
check('the page carries a public key', !!pagePub)
check('it is a full uncompressed P-256 point (87 chars, starts with B)',
  !!pagePub && pagePub.length === 87 && pagePub[0] === 'B', pagePub && String(pagePub.length))
if (privMatch) {
  // The pair only works as a pair. If these two ever disagree, every
  // subscription is signed against a key the function cannot prove it owns
  // and every push is rejected, with nothing on the client saying why.
  const envPub = (envLocal.match(/^VAPID_PUBLIC_KEY=(\S+)/m) || [])[1]
  check('the page and .env.local hold the SAME public key', pagePub === envPub,
    pagePub === envPub ? '' : 'page and .env.local disagree - rotation left them out of step')
}

// ---------------------------------------------------------------------------
console.log('\n[8] the service worker cannot fail silently')
check('it lives at the repo root, or it could never control the board',
  fs.existsSync(path.join(ROOT, 'sw.js')))
check('a malformed payload still shows something true, never nothing',
  /catch \(e\) \{ data = \{\} \}/.test(sw) && /data\.title \|\| 'Rest is up'/.test(sw))
check('clicking focuses the board rather than opening a second copy',
  /'focus' in c\) return c\.focus\(\)/.test(sw))
check('no caching, so it can never serve a stale tile',
  !/caches\.open|cache\.addAll/.test(sw))

console.log('\n[9] permission is only ever asked for on an explicit tap')
check('nothing requests permission at load time',
  !/^\s*Notification\.requestPermission\(\)/m.test(push.replace(/function enable[\s\S]*?\n  \}/, '')))
check('enable() asks BEFORE subscribing, so the one iOS prompt is not wasted',
  push.indexOf('Notification.requestPermission') < push.indexOf('pushManager.subscribe'))
check('iOS outside the home screen is named as its own reason',
  /only works from the home screen icon/.test(push))
check('isEnabled reads the browser, not a saved flag',
  /Notification\.permission !== 'granted'/.test(push) && /getSubscription\(\)/.test(push))

console.log('\n[10] the sealed tile asks the host, because it cannot do it itself')
check('the tile exposes restTimer on the bridge', /restTimer: function \(seconds, label\)/.test(lifting))
check('startRest asks for the backup push', /Vitality\.restTimer\(secs, ex \|\| null\)/.test(lifting))
check('guarded, so an older host or the hosted board is unaffected',
  /window\.Vitality && Vitality\.restTimer/.test(lifting))
check('the host handles restTimer', /msg\.type === 'restTimer'/.test(host))
check('and only schedules when this device is actually subscribed',
  /VitalityPush\.isEnabled\(\)\.then\(function \(on\) \{\s*\n\s*if \(!on\) return/.test(host))
check('a failure there never breaks the on-screen countdown',
  /never let a backup alert break the timer/.test(host))

console.log('\n[11] the vault writes are scoped like every other write')
check('savePushSubscription upserts on endpoint', /onConflict: 'endpoint'/.test(remote))
check('it refuses when signed out rather than writing a row with no owner',
  /A timer has to live in your vault to survive the phone locking/.test(remote))
check('it refuses an incomplete subscription',
  /came back incomplete, so nothing was saved/.test(remote))
check('scheduleRestPush stores an absolute time, not a duration',
  /new Date\(Date\.now\(\) \+ secs \* 1000\)\.toISOString\(\)/.test(remote))
check('all four are on the public API',
  /savePushSubscription: savePushSubscription/.test(remote) &&
  /removePushSubscription: removePushSubscription/.test(remote) &&
  /scheduleRestPush: scheduleRestPush/.test(remote) &&
  /getActiveRestTimer: getActiveRestTimer/.test(remote))

// ---------------------------------------------------------------------------
// The on-screen countdown resuming after the app is closed and reopened.
// Reported directly: "when I close the app, the clock doesn't continue."
// That was true even before push existed - restTimer/restLeft/restTotal are
// plain JS vars with nothing reading them back on load - and is only fixable
// now because scheduleRestPush() gave the real end time somewhere to live.
console.log('\n[12] getActiveRestTimer reads the right row, and only that row')
check('scoped to the signed-in user, not the device',
  /\.eq\('user_id', session\.user\.id\)/.test(remote))
check('only a timer that has not fired', /\.eq\('fired', false\)/.test(remote))
check('only one that has not already come due',
  /\.gt\('fire_at', new Date\(\)\.toISOString\(\)\)/.test(remote))
check('the most recently STARTED one, if more than one is pending',
  /\.order\('created_at', \{ ascending: false \}\)/.test(remote))
check('bounded to one row', /\.limit\(1\)/.test(remote))
check('ok:false (a failed read) is distinguishable from ok:true with no timer',
  /return \{ ok: false \}/.test(remote) && /timer: null/.test(remote))

console.log('\n[13] the host always answers, even to say it does not know')
check('handles checkRestTimer', /msg\.type === \x27checkRestTimer\x27/.test(host))
check('answers even when VitalityRemote is missing, rather than leaving the tile hanging',
  /if \(!window\.VitalityRemote \|\| !window\.VitalityRemote\.getActiveRestTimer\)/.test(host))
check('a thrown read still gets a reply', /\.catch\(function \(\) \{\s*\n\s*src\.postMessage\(\{ source: 'vitality-host', type: 'checkRestTimer:result'/.test(host))

console.log('\n[14] resuming never re-schedules, never invents a stale clock')
check('checkRestTimer on the bridge is a SINGLE attempt, not load\x27s retry loop',
  /checkRestTimer: function \(\) \{[\s\S]{0,300}?setTimeout\(function \(\) \{/.test(lifting) &&
  !/checkRestTimer[\s\S]{0,400}setInterval/.test(lifting))
check('beginRestDisplay is the one place that starts the interval, used by both paths',
  (lifting.match(/restTimer = setInterval\(tickRest, 1000\)/g) || []).length === 1)
check('startRest still schedules the backup push', /if \(window\.Vitality && Vitality\.restTimer\) Vitality\.restTimer\(secs, ex \|\| null\)/.test(lifting))
check('resumeRestFromServer does NOT call Vitality.restTimer - the row already exists',
  !/function resumeRestFromServer[\s\S]{0,600}?Vitality\.restTimer\(/.test(lifting))
check('a countdown already running locally is left alone, not overwritten',
  /if \(restTimer\) return;\s*\/\/ already counting down locally/.test(lifting))
check('a stale timer from long ago is not resumed', /RESUME_CAP_SECS/.test(lifting) &&
  /left > RESUME_CAP_SECS/.test(lifting))
check('an already-expired fire_at is not resumed either', /left <= 0/.test(lifting))
check('only checked on the full page, not the grid poster, and only after the vault answered',
  /loaded = true;\s*\n\s*enable\(true\);\s*\n[\s\S]{0,320}?if \(mode === 'page'\) resumeRestFromServer\(\);/.test(lifting))

// Settle the async crypto checks before reporting. Exiting first would print a
// pass count that had not finished counting.
Promise.all(deferred).then(() => {
  console.log(`\n${fails} failure(s)`)
  process.exit(fails ? 1 : 0)
})
