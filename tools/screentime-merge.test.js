/**
 * THE EXPORT'S ARITHMETIC, checked against a real SQLite.
 * Plain node: `node tools/screentime-merge.test.js`.
 *
 * tools/screentime-export.sh runs on a Mac and reads a database that only
 * exists there, so on any other machine none of it can be run - and the part
 * most likely to be quietly wrong is not the plumbing, it is the SQL.
 *
 * WHY THE SQL IS THE RISK. Raw /app/usage rows OVERLAP. Two rows for the same
 * app can cover the same seconds, and different apps certainly do, because a
 * phone hands off between them. Summing the durations is the obvious thing to
 * write and it is wrong in a way that looks completely plausible: it is
 * entirely possible to get thirty hours out of a twenty-four hour day. So the
 * query merges overlapping intervals into islands first and measures the
 * islands - per app for the breakdown, and once across everything for the
 * total. This suite is the only place that arithmetic is ever proved.
 *
 * THE QUERY IS READ OUT OF THE SHELL SCRIPT, not copied into this file. A test
 * that holds its own copy stops testing the thing that ships the moment either
 * one is edited, which is exactly how tools/squeeze-check.js came to report
 * "no text is squeezed" with the bug it was written for sitting in the file.
 * If the extraction below stops finding the query, that is a FAILURE and not a
 * skip, because a silently un-run check is worse than no check.
 *
 * Needs node:sqlite, which is Node 22 and up. On anything older it says so and
 * skips, the same way run-tests.sh skips the browser checks - loudly, so it is
 * never silently forgotten.
 */
const fs = require('fs')
const path = require('path')

let DatabaseSync
try {
  ({ DatabaseSync } = require('node:sqlite'))
} catch (e) {
  console.log('\nSkipped the screen time merge check: this node has no node:sqlite (needs Node 22+).')
  console.log('  node --version says ' + process.version)
  process.exit(0)
}

const SH = path.join(__dirname, 'screentime-export.sh')
const src = fs.readFileSync(SH, 'utf8')

// Pull the query out of day_query(), between the sqlite3 invocation and its
// closing quote. Substitution of the shell's own variables happens below.
const open = src.indexOf(`sqlite3 -separator '|' "$COPY" "`)
if (open === -1) throw new Error('could not find the day query in ' + SH)
const from = src.indexOf('\n', open)
const close = src.indexOf('\n  " 2>/dev/null', from)
if (close === -1) throw new Error('could not find the end of the day query in ' + SH)
const TEMPLATE = src.slice(from + 1, close)

// A crude sanity check that the right block was grabbed, so a refactor that
// moves the query cannot leave this suite happily testing an empty string.
;['with bounds as', 'islands as', 'ZSTREAMNAME', '$COCOA', '$DEVICE_SQL', '$sel', '$part']
  .forEach(needle => {
    if (TEMPLATE.indexOf(needle) === -1) {
      throw new Error(`the extracted query is missing ${needle} - extraction is out of date`)
    }
  })

const COCOA = 978307200
const DAY = '2026-09-05'
const DEVICE_SQL = "and s.ZDEVICEID = 'IPHONE1'"

const build = (sel, part) => TEMPLATE
  .split('$COCOA').join(String(COCOA))
  .split('$DEVICE_SQL').join(DEVICE_SQL)
  .split('$sel').join(sel)
  .split('$part').join(part)
  .split('$d').join(DAY)

const db = new DatabaseSync(':memory:')
db.exec(`
  create table ZSOURCE (Z_PK integer primary key, ZDEVICEID text);
  create table ZSYNCPEER (ZDEVICEID text, ZMODEL text, ZNAME text);
  create table ZOBJECT (Z_PK integer primary key, ZSTREAMNAME text,
    ZVALUESTRING text, ZSTARTDATE real, ZENDDATE real, ZSOURCE integer);
  insert into ZSOURCE (Z_PK, ZDEVICEID) values (1,'IPHONE1'),(2,NULL);
`)

// Local midnight for DAY, computed the way the script computes it rather than
// worked out here, so a wrong timezone assumption shows up as a wrong answer.
const d0 = db.prepare(`select strftime('%s', ? || ' 00:00:00', 'utc') + 0 as e`).get(DAY).e
const at = (h, m) => d0 + h * 3600 + m * 60
const cocoa = (u) => u - COCOA

let pk = 0
const add = (app, s, e, srcRow = 1) => db.prepare(
  `insert into ZOBJECT (Z_PK, ZSTREAMNAME, ZVALUESTRING, ZSTARTDATE, ZENDDATE, ZSOURCE)
   values (?, '/app/usage', ?, ?, ?, ?)`
).run(++pk, app, cocoa(s), cocoa(e), srcRow)

// Two overlapping Safari sessions, 10:00-11:00 and 10:30-11:30. The union is
// 90 minutes. A naive SUM would report 120.
add('Safari', at(10, 0), at(11, 0))
add('Safari', at(10, 30), at(11, 30))
// Instagram sits ENTIRELY INSIDE that Safari span. Its own 30 minutes are
// real and belong in the breakdown, and it must add nothing at all to the
// day's total - which is why the total merges across apps too, not just
// within one.
add('Instagram', at(10, 15), at(10, 45))
// Crossing midnight INTO this day: 23:50 the night before until 00:20. Only
// the 20 minutes on this side of midnight belong here.
add('Mail', at(-1, -10), at(0, 20))
// A row from the Mac itself - no device id. Must be excluded outright, or the
// laptop's hours get reported as the phone's.
add('Safari', at(14, 0), at(15, 0), 2)

const perApp = db.prepare(build('app', 'partition by app')).all()
const total = db.prepare(build("'total'", '')).all()

let fails = 0
const check = (label, got, want) => {
  const ok = got === want
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  -> got ${got}, want ${want}`}`)
  if (!ok) fails++
}

const byApp = Object.fromEntries(perApp.map(r => [r.k, r.mins]))

console.log('\n[1] overlapping sessions are merged, never summed')
check('two overlapping Safari sessions become their union', byApp.Safari, 90)
check('an app inside another app keeps its own minutes', byApp.Instagram, 30)

console.log('\n[2] a day is clamped to its own midnights')
check('a session crossing into the day contributes only its share', byApp.Mail, 20)

console.log('\n[3] the device filter is real')
check('the Mac rows are gone, leaving three apps', perApp.length, 3)
check('and Safari is not inflated by the Mac hour', byApp.Safari, 90)

console.log('\n[4] the day total is a union across apps, not a sum of them')
// 20 (Mail, 00:00-00:20) + 90 (10:00-11:30, with Instagram entirely inside).
// Summing the per-app figures would give 140, and summing raw rows 170.
check('total', total[0].mins, 110)
check('which is not the sum of the per-app figures',
  total[0].mins !== byApp.Safari + byApp.Instagram + byApp.Mail, true)

console.log('\n[5] a day with nothing in it returns nothing, never a zero')
const empty = db.prepare(build("'total'", '').split(DAY).join('2020-01-01')).all()
// The script reads this as "nothing measured, skipped" and sends no row. A
// zero would file a phone-free day as a fact.
check('no rows at all', empty.length, 0)

console.log(`\n${fails} failure(s)`)
process.exit(fails ? 1 : 0)
