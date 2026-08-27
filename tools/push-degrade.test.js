/**
 * THE MIGRATION-BEHIND TEST. Runs the REAL lib/vault-remote.js against a fake
 * Supabase and proves the rest alert still gets scheduled when the database is
 * one migration behind the code.
 *
 * Why this exists. `note` (the set number in the alert) shipped on 2026-08-08
 * before supabase/push.sql had been re-run on Ruben's project. PostgREST
 * rejected the whole insert, no timer row was ever written, and the
 * notification simply stopped arriving. The on-screen countdown carried on
 * perfectly, which is what made it look like "notifications are broken" rather
 * than "a column is missing".
 *
 * tools/push.test.js greps the source for the fallback. That proves the words
 * are there, not that they work - so this actually calls the function and
 * watches which rows it tries to insert.
 *
 * Plain node: `node tools/push-degrade.test.js`. No browser, no network.
 */
const fs = require('fs')
const path = require('path')
const vm = require('vm')

const SRC = fs.readFileSync(path.join(__dirname, '..', 'lib', 'vault-remote.js'), 'utf8')

let fails = 0
const check = (label, cond, extra) => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${cond || extra === undefined ? '' : '  -> ' + extra}`)
  if (!cond) fails++
}

/**
 * A Supabase stand-in. `reject` decides which insert fails and how, so one
 * harness covers "column missing", "column present" and "something genuinely
 * broken" without three different fakes. `session` false means signed out.
 */
function makeBoard(reject, session = { user: { id: 'u1' } }) {
  const inserts = []
  const warnings = []
  const client = {
    auth: {
      getSession: () => Promise.resolve({ data: { session }, error: null }),
      onAuthStateChange: () => {}
    },
    from(table) {
      return {
        insert(row) {
          inserts.push({ table, row })
          const err = reject(row, inserts.length)
          return Promise.resolve(err ? { error: err } : { error: null })
        }
      }
    }
  }
  const win = {
    supabase: { createClient: () => client },
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_ANON_KEY: 'anon',
    addEventListener: () => {},
    location: { href: 'https://example.test/' },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0 }
  }
  const sandbox = {
    window: win,
    document: { addEventListener: () => {} },
    console: { warn: (...a) => warnings.push(a.join(' ')), error: () => {}, log: () => {} },
    setTimeout, clearTimeout, Promise, Date, JSON, Object, Array, String, Number, isFinite, RegExp
  }
  sandbox.globalThis = sandbox
  vm.createContext(sandbox)
  vm.runInContext(SRC, sandbox)
  return { remote: win.VitalityRemote, inserts, warnings }
}

const MISSING = {
  code: 'PGRST204',
  message: "Could not find the 'note' column of 'rest_timers' in the schema cache"
}

;(async () => {
  // ── 1. The database is up to date ──────────────────────────────────────────
  console.log('\n[1] column present: one insert, with the note')
  {
    const b = makeBoard(() => null)
    const r = await b.remote.scheduleRestPush(180, 'Barbell Bench Press', 'Barbell Bench Press, set 4.')
    check('scheduled', r.ok === true, JSON.stringify(r))
    check('exactly one insert, no retry', b.inserts.length === 1, b.inserts.length)
    check('it went to rest_timers', b.inserts[0].table === 'rest_timers', b.inserts[0].table)
    check('the note went with it', b.inserts[0].row.note === 'Barbell Bench Press, set 4.', b.inserts[0].row.note)
    check('the label stayed the bare exercise name', b.inserts[0].row.label === 'Barbell Bench Press', b.inserts[0].row.label)
    check('not reported as degraded', !r.degraded, JSON.stringify(r))
  }

  // ── 2. THE BUG ITSELF ──────────────────────────────────────────────────────
  console.log('\n[2] column missing: retries WITHOUT the note, and still schedules')
  {
    const b = makeBoard(row => ('note' in row ? MISSING : null))
    const r = await b.remote.scheduleRestPush(300, 'Back Squat', 'Back Squat, set 2. Last time 140 kg x 5.')
    check('STILL SCHEDULED - the alert is not lost', r.ok === true, JSON.stringify(r))
    check('it retried', b.inserts.length === 2, b.inserts.length)
    check('the retry carries no note key at all', !('note' in b.inserts[1].row), JSON.stringify(b.inserts[1].row))
    check('the retry keeps the time', typeof b.inserts[1].row.fire_at === 'string', b.inserts[1].row.fire_at)
    check('the retry keeps the label, so a resumed timer still knows its length',
      b.inserts[1].row.label === 'Back Squat', b.inserts[1].row.label)
    check('it names the missing migration out loud',
      b.warnings.some(w => /push\.sql/.test(w)), b.warnings.join(' | '))
    check('and reports the degrade to its caller', r.degraded === 'note', JSON.stringify(r))
  }

  // ── 3. Postgres's own code for the same thing ──────────────────────────────
  console.log('\n[3] the bare Postgres code (42703) is recognised too')
  {
    const b = makeBoard(row => ('note' in row ? { code: '42703', message: 'column "note" does not exist' } : null))
    const r = await b.remote.scheduleRestPush(180, 'Dip', 'Dip, set 3.')
    check('still scheduled', r.ok === true, JSON.stringify(r))
    check('retried once', b.inserts.length === 2, b.inserts.length)
  }

  // ── 4. A REAL failure must NOT be swallowed by the retry ───────────────────
  console.log('\n[4] a genuine failure is still a failure, not a silent retry')
  {
    const b = makeBoard(() => ({ code: '42501', message: 'new row violates row-level security policy' }))
    const r = await b.remote.scheduleRestPush(180, 'Deadlift', 'Deadlift, set 1.')
    check('reported as not ok', r.ok === false, JSON.stringify(r))
    check('no pointless retry against a permissions error', b.inserts.length === 1, b.inserts.length)
  }

  // ── 5. Signed out still writes nothing ─────────────────────────────────────
  console.log('\n[5] signed out writes no row, exactly as before')
  {
    const b = makeBoard(() => null, null)
    const r = await b.remote.scheduleRestPush(180, 'Dip', 'Dip, set 3.')
    check('refused', r.ok === false, JSON.stringify(r))
    check('nothing was written', b.inserts.length === 0, b.inserts.length)
  }

  // ── 6. A timer with no note at all (the Rest button on no exercise) ────────
  console.log('\n[6] no note to send is not a degrade, it is just an empty note')
  {
    const b = makeBoard(() => null)
    const r = await b.remote.scheduleRestPush(180, null, null)
    check('scheduled', r.ok === true, JSON.stringify(r))
    check('one insert', b.inserts.length === 1, b.inserts.length)
    check('note is null, not undefined', b.inserts[0].row.note === null, String(b.inserts[0].row.note))
  }

  console.log(`\n${fails} failure(s)`)
  process.exit(fails ? 1 : 0)
})()
