/**
 * Reminders. Plain node: `node tools/reminders.test.js`.
 *
 * End to end delivery cannot be tested here - that needs a real push service
 * and a real locked phone. What CAN be pinned is every rule that decides
 * whether a reminder arrives once, twice, never, or at a moment nobody asked
 * for. Those rules are the whole feature; the rest is plumbing that already
 * existed for the rest timer.
 *
 * IT IMPORTS THE REAL SENDER LOGIC rather than re-implementing it. dueKey and
 * friends live in send-reminder-push/due.mjs precisely so that node and Deno
 * run the same file. A test that re-implements the rule and then asserts the
 * source still LOOKS like it agrees is how two copies drift apart with one of
 * them wrong, and it is the failure this repo has already paid for once
 * (vault/decisions.md).
 *
 * The four questions it exists to answer, none of which should ever be
 * answered by waiting until 07:00 with a phone in your hand:
 *   - does it go off at the right time, in HIS timezone, across a DST change
 *   - can it go off twice
 *   - can it go off the instant it is saved, for a time already gone
 *   - can moving a reminder to a later hour silently swallow it
 */
const fs = require('fs')
const path = require('path')
const { pathToFileURL } = require('url')

const ROOT = path.join(__dirname, '..')
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8')

const fn = read('supabase/functions/send-reminder-push/index.ts')
const sql = read('supabase/reminders.sql')
const sw = read('sw.js')
const host = read('lib/tiles/host.js')
const remote = read('lib/vault-remote.js')
const registry = read('lib/tiles/registry.js')
const tile = read('tiles/reminders.html')

let fails = 0
const check = (label, cond, extra) => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${cond || extra === undefined ? '' : '  -> ' + extra}`)
  if (!cond) fails++
}

const utc = (y, m, d, h, mi) => Date.UTC(y, m - 1, d, h, mi, 0, 0)
const iso = ms => new Date(ms).toISOString()

// 2026-09-07 is a Monday, 09-12 a Saturday, 09-13 a Sunday. Asserted rather
// than trusted, because every weekday rule below is built on it.
const MON = utc(2026, 9, 7, 0, 0)
const SAT = utc(2026, 9, 12, 0, 0)
const SUN = utc(2026, 9, 13, 0, 0)

/** A reminder with sane defaults, so each test states only what it is about. */
const rem = (over = {}) => Object.assign({
  user_id: 'u1', id: 'r1', title: 'Take creatine', body: '',
  at_time: '07:00', tz: 'UTC', repeat: 'daily', days: [], on_date: null,
  enabled: true, sticky: false, last_fired_key: null,
  // Written well before any occurrence these tests fire, so the "newer than
  // the rule" guard is out of the way unless a test is specifically about it.
  updated_at: '2026-01-01T00:00:00.000Z'
}, over)

async function main() {
  const due = await import(pathToFileURL(
    path.join(ROOT, 'supabase/functions/send-reminder-push/due.mjs')).href)
  const { dueKey, localParts, ruleMatchesDay, GRACE_MIN } = due

  console.log('\n[1] what time is it where he is')
  check('the weekday numbering matches getDay(), which every rule assumes',
    localParts(MON, 'UTC').weekday === 1 &&
    localParts(SAT, 'UTC').weekday === 6 &&
    localParts(SUN, 'UTC').weekday === 0,
    [localParts(MON, 'UTC').weekday, localParts(SAT, 'UTC').weekday, localParts(SUN, 'UTC').weekday].join(','))
  check('the date is his local date, not the server\'s',
    localParts(utc(2026, 9, 7, 23, 30), 'Europe/Zurich').date === '2026-09-08',
    localParts(utc(2026, 9, 7, 23, 30), 'Europe/Zurich').date)
  check('and the minutes are his local minutes',
    localParts(utc(2026, 9, 7, 5, 0), 'Europe/Zurich').minutes === 7 * 60,
    String(localParts(utc(2026, 9, 7, 5, 0), 'Europe/Zurich').minutes))
  // Midnight is the one that would have taken the whole list out at once: an
  // engine reporting hour '24' rather than '00' turns 00:10 into minute 1450,
  // which is past every reminder in the day.
  check('midnight is minute 0, never minute 1440',
    localParts(utc(2026, 9, 7, 0, 10), 'UTC').minutes === 10,
    String(localParts(utc(2026, 9, 7, 0, 10), 'UTC').minutes))
  check('a timezone nobody recognises falls back to UTC instead of throwing',
    localParts(utc(2026, 9, 7, 7, 0), 'Mars/Olympus').minutes === 420)

  console.log('\n[2] it fires at the time he picked, and not before')
  check('not a minute early', dueKey(rem(), utc(2026, 9, 7, 6, 59)) === null)
  check('on the minute', dueKey(rem(), utc(2026, 9, 7, 7, 0)) === '2026-09-07@07:00',
    String(dueKey(rem(), utc(2026, 9, 7, 7, 0))))
  check('still worth sending inside the grace window',
    dueKey(rem(), utc(2026, 9, 7, 7, GRACE_MIN - 1)) === '2026-09-07@07:00')
  // The bound is what makes a broken hour cost an hour rather than landing at
  // some meaningless moment that evening.
  check('never after it, so a dead hour does not deliver at midnight',
    dueKey(rem(), utc(2026, 9, 7, 7, GRACE_MIN + 1)) === null)
  check('a switched-off reminder is silent', dueKey(rem({ enabled: false }), utc(2026, 9, 7, 7, 0)) === null)
  check('a time that is not a time fires nothing rather than throwing',
    dueKey(rem({ at_time: 'soon' }), utc(2026, 9, 7, 7, 0)) === null &&
    dueKey(rem({ at_time: '25:00' }), utc(2026, 9, 7, 7, 0)) === null &&
    dueKey(rem({ at_time: '' }), utc(2026, 9, 7, 7, 0)) === null)

  console.log('\n[3] the repeat rules')
  const at7 = (r, day) => dueKey(rem(r), day + 7 * 3600 * 1000) !== null
  check('daily means every day', at7({ repeat: 'daily' }, MON) && at7({ repeat: 'daily' }, SAT))
  check('weekdays skips the weekend',
    at7({ repeat: 'weekdays' }, MON) && !at7({ repeat: 'weekdays' }, SAT) && !at7({ repeat: 'weekdays' }, SUN))
  check('weekends skips the week',
    !at7({ repeat: 'weekends' }, MON) && at7({ repeat: 'weekends' }, SAT) && at7({ repeat: 'weekends' }, SUN))
  check('picked days means exactly those days',
    at7({ repeat: 'days', days: [1] }, MON) && !at7({ repeat: 'days', days: [1] }, SAT))
  check('no days picked means it never fires, rather than every day',
    !at7({ repeat: 'days', days: [] }, MON))
  check('a one-off fires on its date',
    at7({ repeat: 'once', on_date: '2026-09-07' }, MON))
  check('and on no other day',
    !at7({ repeat: 'once', on_date: '2026-09-07' }, SAT))
  check('a one-off with no date fires nothing',
    !at7({ repeat: 'once', on_date: null }, MON))
  // A rule this server does not understand must never be the one that
  // notifies someone every day for ever.
  check('a repeat it has never heard of matches nothing at all',
    !at7({ repeat: 'fortnightly' }, MON) && !at7({ repeat: '' }, SAT))

  console.log('\n[4] it cannot go off twice')
  check('the stamp for today stops a second send',
    dueKey(rem({ last_fired_key: '2026-09-07@07:00' }), utc(2026, 9, 7, 7, 5)) === null)
  check('but yesterday\'s stamp does not stop today',
    dueKey(rem({ last_fired_key: '2026-09-06@07:00' }), utc(2026, 9, 7, 7, 0)) === '2026-09-07@07:00')
  /**
   * THE ONE A PLAIN DATE WOULD HAVE SWALLOWED. Fire the 07:00, then move it to
   * 22:00 that same afternoon. With a date-only stamp, today is already marked
   * done and the 22:00 never comes - silently, with the tile still showing a
   * healthy reminder. The time is part of the key, so 22:00 is an occurrence
   * this rule has not fired.
   */
  check('moving a reminder later the same day still fires it',
    dueKey(rem({ at_time: '22:00', last_fired_key: '2026-09-07@07:00' }),
      utc(2026, 9, 7, 22, 0)) === '2026-09-07@22:00')

  console.log('\n[5] it never goes off the instant it is saved')
  /**
   * Set at 08:00 for 07:30. 07:30 today is still inside the grace window, so
   * without the guard the phone buzzes in his hand as he taps Save - which
   * reads as a bug and is certainly not what was asked for.
   */
  check('a time already gone today waits for the next one',
    dueKey(rem({ at_time: '07:30', updated_at: iso(utc(2026, 9, 7, 8, 0)) }),
      utc(2026, 9, 7, 8, 1)) === null)
  check('and the next one does arrive',
    dueKey(rem({ at_time: '07:30', updated_at: iso(utc(2026, 9, 7, 8, 0)) }),
      utc(2026, 9, 8, 7, 30)) === '2026-09-08@07:30')
  check('a rule written before the occurrence is unaffected',
    dueKey(rem({ at_time: '07:30', updated_at: iso(utc(2026, 9, 7, 7, 0)) }),
      utc(2026, 9, 7, 7, 30)) === '2026-09-07@07:30')

  console.log('\n[6] 07:00 stays 07:00 when the clocks change')
  /**
   * Europe/Zurich is UTC+2 in summer and UTC+1 in winter. A stored absolute
   * instant would drift an hour twice a year; a stored RULE cannot. Both of
   * these are 07:00 on his own clock, five months apart.
   */
  const zurich = { tz: 'Europe/Zurich', repeat: 'daily', at_time: '07:00' }
  check('summer: 05:00 UTC is 07:00 in Zurich, and it fires',
    dueKey(rem(zurich), utc(2026, 7, 15, 5, 0)) === '2026-07-15@07:00',
    String(dueKey(rem(zurich), utc(2026, 7, 15, 5, 0))))
  check('summer: 06:00 UTC is 08:00 there, an hour late but inside the grace',
    dueKey(rem(zurich), utc(2026, 7, 15, 6, 0)) === '2026-07-15@07:00')
  check('winter: 06:00 UTC is 07:00 in Zurich, and it fires',
    dueKey(rem(zurich), utc(2026, 12, 15, 6, 0)) === '2026-12-15@07:00',
    String(dueKey(rem(zurich), utc(2026, 12, 15, 6, 0))))
  check('winter: 05:00 UTC is 06:00 there, and it does not',
    dueKey(rem(zurich), utc(2026, 12, 15, 5, 0)) === null)

  console.log('\n[7] the rule is only ever asked about one day')
  check('ruleMatchesDay is pure and takes the day it is judging',
    ruleMatchesDay({ repeat: 'weekdays' }, '2026-09-07', 1) === true &&
    ruleMatchesDay({ repeat: 'weekdays' }, '2026-09-12', 6) === false)

  // -------------------------------------------------------------------------
  // The wiring. Not logic, but each of these is a way the whole feature is
  // dead or dangerous while every visible thing still looks healthy.
  // -------------------------------------------------------------------------
  console.log('\n[8] the vault cannot be reached by the wrong tile')
  /**
   * save and load are safe for any tile because they are routed to the
   * sender's own slot. Reminder rows are keyed by the PERSON, and the sync
   * deletes everything not in the list it is handed - so without this gate a
   * tile pasted in from someone else's repo could wipe every reminder he has
   * with one message.
   */
  check('the host refuses reminder messages from any tile but reminders',
    /tileId !== 'reminders'/.test(host))
  check('the gate uses the verified sender id, never one from the message',
    /var tileId = reg\.get\(src\)/.test(host))
  check('the host handles all three reminder messages',
    /'reminders:sync'/.test(host) && /'reminders:state'/.test(host) && /'reminders:push'/.test(host))
  check('every reminder message answers, so the tile never waits for ever',
    /payload\.type = msg\.type \+ ':result'/.test(host))

  console.log('\n[9] the sync cannot undo what the sender recorded')
  /**
   * last_fired_key is the only thing stopping a reminder going off twice, and
   * it is written by the sender. If the tile's sync included it, every save
   * would rearm every reminder that had already gone off today.
   */
  const syncBody = remote.slice(remote.indexOf('function syncReminders'),
    remote.indexOf('function readReminders'))
  check('the sync never writes last_fired_key', !/last_fired_key/.test(syncBody))
  check('it does send updated_at, which is what dates the rule',
    /updated_at:/.test(syncBody))
  check('a missing table is named rather than shrugged at',
    /reminders\.sql/.test(remote) && /needsMigration/.test(remote))
  check('ids are stripped of the commas PostgREST splits that list on',
    /replace\(\/\[\(\),"\]\/g, ''\)/.test(syncBody))
  check('an emptied list deletes them all rather than crashing on `in ()`',
    /ids\.length/.test(syncBody))

  console.log('\n[10] the notification says what he wrote, and nothing else')
  check('the title is his', /title: r\.title/.test(fn))
  check('the body is his, with no invented sentence when it is empty',
    /body: r\.body \|\| ''/.test(fn))
  check('each reminder gets its own tag, so two at 07:00 both appear',
    /tag: 'reminder:' \+ r\.id/.test(fn))
  check('the worker passes sticky through instead of deciding for itself',
    /requireInteraction: !!data\.sticky/.test(sw))
  check('a one-off switches itself off after it goes',
    /if \(r\.repeat === 'once'\) patch\.enabled = false/.test(fn))
  check('updated_at is not bumped on send, which would break the newer-than-rule guard',
    !/updated_at:/.test(fn.slice(fn.indexOf('const patch'))))
  check('a dead subscription is deleted rather than retried for ever',
    /GONE\.has\(status\)/.test(fn))
  check('it stamps even when every device failed, or it retries all hour',
    fn.indexOf('last_fired_key: key') > fn.indexOf('for (const s of await subsFor'))

  console.log('\n[11] the table is his alone')
  check('row level security is on', /alter table reminders enable row level security/.test(sql))
  check('the policy is scoped to the signed-in user',
    /auth\.uid\(\) = user_id/.test(sql))
  // RLS never even evaluates without the grant. Same law as sync.sql.
  check('and the grant exists, or RLS is never even consulted',
    /grant select, insert, update, delete on reminders to authenticated/.test(sql))
  check('the key is (user_id, id), so two boards cannot collide on r1',
    /primary key \(user_id, id\)/.test(sql))
  check('nothing deletes his reminders on a schedule',
    !/prune_reminders/.test(sql))

  console.log('\n[12] the tile is sealed, registered and honest')
  check('it is in the registry', /id: 'reminders'/.test(registry))
  check('it declares its store shape, or it is not finished',
    /store shape via Vitality\.save\/load/.test(tile))
  check('it says out loud that it reports nothing to the ledger',
    /THIS TILE REPORTS NOTHING/.test(tile))
  check('and it is absent from every goal in the equation',
    !/reminders:/.test(read('lib/tiles/weights.ts').split('DEFAULT_GOALS')[1] || ''))
  check('the poster number is a clamp, not a fixed size',
    /\.posterHero \.num\{ font-size:clamp\(/.test(tile))
  check('it never claims to be on when it cannot be',
    /Signed out\./.test(tile) && /Notifications are off on this device/.test(tile))
  check('a timed-out sync is reported as unknown, never as saved',
    /timedOut/.test(tile) && /did not answer/.test(tile))
  // Signed out, enabling would ask the phone for permission and then fail on
  // the way to the vault, because a subscription is stored against an account.
  // A button that cannot work is a second instruction pointing the wrong way.
  check('the notifications button is only offered when it can actually work',
    /if \(host\.signedIn && \(host\.push === 'off' \|\| host\.push === 'on'\)\)/.test(tile))
  check('an unanswered load never overwrites what is really there',
    /if \(res && res\.ok\)/.test(tile) && /loaded = true/.test(tile))

  console.log(`\n${fails} failure(s)`)
  process.exit(fails ? 1 : 0)
}

main().catch(e => {
  console.error('\nthe suite itself threw:', e && e.stack || e)
  process.exit(1)
})
