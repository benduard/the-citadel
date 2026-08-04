/**
 * The Lists calendar. Plain node: `node tiles/lists.calendar.test.js`.
 *
 * The thing most worth testing here is WHY the done log exists at all. The
 * obvious build is to derive a calendar from doneAt and the archive - and it
 * fails silently, because roll() sets a repeating item's doneAt back to null
 * and a repeating item never reaches the archive. Test [2] pins that down: it
 * asserts the record survives a roll AND that no other trace of it is left,
 * so if anyone ever "simplifies" the log away, this fails loudly.
 *
 * The rest guards the derivation. Crossed-out is recorded fact; "still open on
 * that day" is worked out from createdAt, and getting that wrong would put
 * items on days they did not exist.
 */
const fs = require('fs')
const vm = require('vm')
const path = require('path')
const src = fs.readFileSync(path.join(__dirname, 'lists.html'), 'utf8')

function grab(name) {
  const re = new RegExp(`\\n  function ${name}\\(`)
  const at = src.search(re)
  if (at === -1) throw new Error('not found: ' + name)
  let i = src.indexOf('{', at), depth = 0, end = i
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') { depth--; if (!depth) { end = i + 1; break } }
  }
  return src.slice(at + 1, end)
}
function grabVar(name, open) {
  const at = src.search(new RegExp(`\\n  var ${name} =`))
  if (at === -1) throw new Error('not found: var ' + name)
  const close = open === '[' ? ']' : '}'
  let i = src.indexOf(open, at), depth = 0, end = i
  for (; i < src.length; i++) {
    if (src[i] === open) depth++
    else if (src[i] === close) { depth--; if (!depth) { end = i + 1; break } }
  }
  return src.slice(src.indexOf(open, at), end)
}

let NOW = new Date(2026, 6, 31) // Fri 2026-07-31
const sandbox = { console }
sandbox.Date = class extends Date {
  constructor(...a) { if (!a.length) super(NOW.getTime()); else super(...a) }
}
vm.createContext(sandbox)
vm.runInContext(`
  var BUILTIN_LISTS = ${grabVar('BUILTIN_LISTS', '[')};
  var LISTS = BUILTIN_LISTS;
  // roll() and backfillDone() reach the lists through allLists() so that a
  // list he made is rolled over too (it has no roll rule, so it passes
  // straight through). These suites test the built-ins, which is what this
  // stands in for.
  function allLists(){ return LISTS; }
  var ROLLING = ${grabVar('ROLLING', '[')};
  var ARCHIVE_CAP = 200;
  var DONE_DAYS_CAP = ${(src.match(/var DONE_DAYS_CAP = (\d+)/) || [])[1]};
  var state, loaded = true, rolledNote = '';
  function listById(id){ for (var i=0;i<LISTS.length;i++) if (LISTS[i].id===id) return LISTS[i]; return LISTS[0]; }
  // toggle() reaches for these three; none of them is what is under test here.
  function persist(){}
  function renderAll(){}
  function reportDone(){}
  ${grab('dateKey')}
  ${grab('todayLocal')}
  ${grab('weekKey')}
  ${grab('daysBetween')}
  ${grab('items')}
  ${grab('openOf')}
  ${grab('doneOf')}
  ${grab('doneCount')}
  ${grab('doneKeyOf')}
  ${grab('logDone')}
  ${grab('unlogDone')}
  ${grab('trimDoneLog')}
  ${grab('backfillDone')}
  ${grab('crossedOn')}
  ${grab('openOn')}
  ${grab('hasRecord')}
  ${grab('dayStatus')}
  ${grab('monthCells')}
  ${grab('roll')}
  ${grab('toggle')}
  function fresh(seed){
    // logFrom defaults far back so most tests exercise the scored path; the
    // unrecorded path gets its own block.
    state = { v:3, lists:{daily:[],weekly:[],grocery:[],projects:[],someday:[]},
              archive:[], done:{}, logFrom:'2000-01-01', rolledOn:'', rolledWeek:'' };
    if (seed) seed(state);
    return state;
  }
`, sandbox)

const S = sandbox
let fails = 0
const check = (label, cond, extra) => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${cond || extra === undefined ? '' : '  -> ' + extra}`)
  if (!cond) fails++
}
const titles = arr => arr.map(e => e.title).sort()

// ---------------------------------------------------------------------------
console.log('\n[1] crossing something off records the day')
S.fresh(st => {
  st.lists.daily.push({ id: 'a', title: 'Call the bank', done: false, repeat: false, createdAt: '2026-07-28', doneAt: null })
})
S.toggle('daily', 'a')
check('recorded under today', !!S.state.done['2026-07-31'])
check('and it is the right item', titles(S.crossedOn('2026-07-31')).join() === 'Call the bank')
check('nothing recorded on any other day', Object.keys(S.state.done).join() === '2026-07-31')
check('the log carries createdAt, not just the title',
  S.state.done['2026-07-31'][0].createdAt === '2026-07-28',
  S.state.done['2026-07-31'][0].createdAt)

// unticking
S.toggle('daily', 'a')
check('unticking removes the record entirely', !S.state.done['2026-07-31'])
check('an emptied day is deleted, not left as []', !('2026-07-31' in S.state.done))

// ---------------------------------------------------------------------------
console.log('\n[2] THE REASON THIS LOG EXISTS: a repeating item survives the roll')
S.fresh(st => {
  st.rolledOn = '2026-07-31'
  st.rolledWeek = '2026-07-27'
  st.lists.daily.push({ id: 'g', title: 'Gym', done: false, repeat: true, createdAt: '2026-07-01', doneAt: null })
})
S.toggle('daily', 'g')
check('crossed off on the 31st', titles(S.crossedOn('2026-07-31')).join() === 'Gym')

NOW = new Date(2026, 7, 1)              // the next morning
S.roll()

const gym = S.state.lists.daily[0]
check('roll unchecked it, as it always did', gym.done === false)
check('roll wiped its doneAt, as it always did', gym.doneAt === null)
check('it never entered the archive, as it never did', S.state.archive.length === 0)
// The two lines above are exactly why deriving is not an option:
check('...so doneAt and the archive now hold NO trace of the 31st',
  !S.state.lists.daily.some(x => x.doneAt === '2026-07-31') &&
  !S.state.archive.some(a => a.doneAt === '2026-07-31'))
check('but the log still knows you went to the gym on the 31st',
  titles(S.crossedOn('2026-07-31')).join() === 'Gym')
NOW = new Date(2026, 6, 31)

// ---------------------------------------------------------------------------
console.log('\n[3] an unfinished item shows as open every day until it is crossed')
S.fresh(st => {
  st.lists.daily.push({ id: 'b', title: 'Call the bank', done: true, repeat: false, createdAt: '2026-07-28', doneAt: '2026-07-31' })
  st.done['2026-07-31'] = [{ id: 'b', title: 'Call the bank', list: 'daily', repeat: false, createdAt: '2026-07-28' }]
})
check('open on the day it was made', titles(S.openOn('2026-07-28', 'daily')).join() === 'Call the bank')
check('still open the next day', titles(S.openOn('2026-07-29', 'daily')).join() === 'Call the bank')
check('still open the day after', titles(S.openOn('2026-07-30', 'daily')).join() === 'Call the bank')
check('NOT open on the day it was crossed', S.openOn('2026-07-31', 'daily').length === 0)
check('...it is crossed that day instead', titles(S.crossedOn('2026-07-31', 'daily')).join() === 'Call the bank')
check('and it did not exist the day before it was made', S.openOn('2026-07-27', 'daily').length === 0)

// ---------------------------------------------------------------------------
console.log('\n[4] it still reads right once the item has left the live list')
S.fresh(st => {
  // archived and gone from lists - only the log remains
  st.done['2026-07-31'] = [{ id: 'b', title: 'Call the bank', list: 'daily', repeat: false, createdAt: '2026-07-28' }]
})
check('the log alone can place it as open on the 29th',
  titles(S.openOn('2026-07-29', 'daily')).join() === 'Call the bank')
check('and it is not duplicated when the live item is there too',
  (S.fresh(st => {
    st.lists.daily.push({ id: 'b', title: 'Call the bank', done: true, repeat: false, createdAt: '2026-07-28', doneAt: '2026-07-31' })
    st.done['2026-07-31'] = [{ id: 'b', title: 'Call the bank', list: 'daily', repeat: false, createdAt: '2026-07-28' }]
  }), S.openOn('2026-07-29', 'daily').length === 1))

// ---------------------------------------------------------------------------
console.log('\n[5] a skipped repeating day reads as skipped, not as never-existing')
S.fresh(st => {
  st.lists.daily.push({ id: 'g', title: 'Gym', done: false, repeat: true, createdAt: '2026-07-01', doneAt: null })
  st.done['2026-07-29'] = [{ id: 'g', title: 'Gym', list: 'daily', repeat: true, createdAt: '2026-07-01' }]
  st.done['2026-07-31'] = [{ id: 'g', title: 'Gym', list: 'daily', repeat: true, createdAt: '2026-07-01' }]
})
check('crossed on the 29th', titles(S.crossedOn('2026-07-29', 'daily')).join() === 'Gym')
check('open (skipped) on the 30th', titles(S.openOn('2026-07-30', 'daily')).join() === 'Gym')
check('crossed again on the 31st', titles(S.crossedOn('2026-07-31', 'daily')).join() === 'Gym')

// ---------------------------------------------------------------------------
console.log('\n[6] a day is only "clear" if there was something to clear')
S.fresh()
check('empty day is not a clear day', S.dayStatus('2026-07-30').clear === false)
check('...and not a failed one either', S.dayStatus('2026-07-30').total === 0)

S.fresh(st => {
  st.lists.daily.push({ id: 'x', title: 'One thing', done: true, repeat: false, createdAt: '2026-07-31', doneAt: '2026-07-31' })
  st.done['2026-07-31'] = [{ id: 'x', title: 'One thing', list: 'daily', repeat: false, createdAt: '2026-07-31' }]
})
check('everything crossed -> clear', S.dayStatus('2026-07-31').clear === true)

S.fresh(st => {
  st.lists.daily.push({ id: 'x', title: 'Done one', done: true, repeat: false, createdAt: '2026-07-31', doneAt: '2026-07-31' })
  st.lists.daily.push({ id: 'y', title: 'Not done', done: false, repeat: false, createdAt: '2026-07-31', doneAt: null })
  st.done['2026-07-31'] = [{ id: 'x', title: 'Done one', list: 'daily', repeat: false, createdAt: '2026-07-31' }]
})
const partial = S.dayStatus('2026-07-31')
check('one of two -> not clear', partial.clear === false)
check('counts both sides', partial.crossed === 1 && partial.open === 1, JSON.stringify(partial))

// a non-rolling list must not make a day look owed
S.fresh(st => {
  st.lists.projects.push({ id: 'p', title: 'Ship it', done: false, repeat: false, createdAt: '2026-07-01', doneAt: null })
})
check('an open PROJECT does not make a day unclear', S.dayStatus('2026-07-31').open === 0)
S.fresh(st => {
  st.done['2026-07-31'] = [{ id: 'p', title: 'Ship it', list: 'projects', repeat: false, createdAt: '2026-07-01' }]
})
check('a finished project still shows on the day', S.dayStatus('2026-07-31').other === 1)

// ---------------------------------------------------------------------------
console.log('\n[7] the month grid is a real calendar')
const july = S.monthCells(2026, 6)
check('rows are whole weeks', july.length % 7 === 0, String(july.length))
check('31 days in July', july.filter(Boolean).length === 31)
check('Monday first: 1 July 2026 is a Wednesday, so two blanks lead',
  july[0] === null && july[1] === null && july[2] === '2026-07-01')
check('last day is the 31st', july.filter(Boolean).pop() === '2026-07-31')
const feb = S.monthCells(2024, 1)
check('leap year February has 29', feb.filter(Boolean).length === 29)
check('every cell is a real date key or a blank',
  july.every(c => c === null || /^\d{4}-\d{2}-\d{2}$/.test(c)))

// ---------------------------------------------------------------------------
console.log('\n[8] day counting survives month ends and DST')
check('across a month end', S.daysBetween('2026-07-28', '2026-08-02') === 5)
check('same day is zero', S.daysBetween('2026-07-31', '2026-07-31') === 0)
check('across a spring DST change (UK, 29 Mar 2026)',
  S.daysBetween('2026-03-28', '2026-03-30') === 2)
check('across an autumn DST change (UK, 25 Oct 2026)',
  S.daysBetween('2026-10-24', '2026-10-26') === 2)
check('a missing date does not throw or produce NaN', S.daysBetween('', '2026-07-31') === 0)

// ---------------------------------------------------------------------------
console.log('\n[9] the v2 backfill uses real dates and invents nothing')
S.fresh(st => {
  st.lists.projects.push({ id: 'p1', title: 'Shipped', done: true, repeat: false, createdAt: '2026-07-10', doneAt: '2026-07-20' })
  st.lists.daily.push({ id: 'd1', title: 'Open one', done: false, repeat: false, createdAt: '2026-07-30', doneAt: null })
  st.archive.push({ title: 'Old daily', list: 'daily', doneAt: '2026-07-15' })
  st.archive.push({ title: 'No date', list: 'daily' })          // v2 could hold this
})
S.backfillDone()
check('a finished item lands on its own doneAt', titles(S.crossedOn('2026-07-20')).join() === 'Shipped')
check('an archive entry lands on its own doneAt', titles(S.crossedOn('2026-07-15')).join() === 'Old daily')
check('an UNfinished item is not recorded anywhere',
  !Object.keys(S.state.done).some(d => S.crossedOn(d).some(e => e.title === 'Open one')))
check('an archive entry with no date is skipped, not given one',
  Object.keys(S.state.done).sort().join() === '2026-07-15,2026-07-20',
  Object.keys(S.state.done).sort().join())
check('backfilling twice does not double up',
  (S.backfillDone(), S.crossedOn('2026-07-20').length === 1))

// ---------------------------------------------------------------------------
console.log('\n[10] the log stays bounded')
S.fresh()
// Built as a list first so the expected answer is "the newest CAP of these",
// not a date worked out by hand - that arithmetic is exactly where an
// off-by-one hides.
const allDays = []
for (let i = 0; i < S.DONE_DAYS_CAP + 40; i++) {
  allDays.push(new Date(Date.UTC(2024, 0, 1 + i)).toISOString().slice(0, 10))
}
allDays.forEach((k, i) => {
  S.state.done[k] = [{ id: 'x' + i, title: 'thing', list: 'daily', repeat: false, createdAt: k }]
})
S.trimDoneLog()
const kept = Object.keys(S.state.done).sort()
check(`capped at ${S.DONE_DAYS_CAP} days`, kept.length === S.DONE_DAYS_CAP, String(kept.length))
check('the days kept are exactly the newest ones',
  kept.join() === allDays.slice(-S.DONE_DAYS_CAP).join())
check('the oldest day is genuinely gone', !(allDays[0] in S.state.done))
check('the newest day is still there', allDays[allDays.length - 1] in S.state.done)

// ---------------------------------------------------------------------------
console.log('\n[11] the calendar never looks into the future')
S.fresh(st => {
  st.lists.daily.push({ id: 'f', title: 'Later', done: false, repeat: false, createdAt: '2026-08-10', doneAt: null })
})
check('an item created in the future is not on today', S.openOn('2026-07-31', 'daily').length === 0)
check('nor on any earlier day', S.openOn('2026-07-01', 'daily').length === 0)

// ---------------------------------------------------------------------------
console.log('\n[12] days before the record began are NOT scored as failures')
S.fresh(st => {
  st.logFrom = '2026-07-25'
  // A habit that has existed since long before the record started.
  st.lists.daily.push({ id: 'g', title: 'Gym', done: false, repeat: true, createdAt: '2026-07-01', doneAt: null })
  st.lists.daily.push({ id: 'b', title: 'Book dentist', done: false, repeat: false, createdAt: '2026-07-02', doneAt: null })
})
const before = S.dayStatus('2026-07-10')
check('a day before logFrom is flagged as unrecorded', before.noRecord === true)
check('...and claims NOTHING was missed', before.missed === 0 && before.carried === 0, JSON.stringify(before))
check('...and is not "clear" either', before.clear === false)
const after = S.dayStatus('2026-07-26')
check('a day after logFrom IS scored', after.noRecord === false)
check('...and sees the habit as missed', after.missed === 1, JSON.stringify(after))
check('...and the one-off as carried, not missed', after.carried === 1)

console.log('\n[13] a stray backfilled tick cannot decorate an unwatched day')
S.fresh(st => {
  st.logFrom = '2026-07-25'
  st.done['2026-07-10'] = [{ id: 'z', title: 'Old thing', list: 'daily', repeat: false, createdAt: '2026-07-09' }]
})
const stray = S.dayStatus('2026-07-10')
check('the real crossed-off mark is still shown', stray.crossed === 1)
check('but the day is NOT reported as clear', stray.clear === false)
check('and it still reads as unrecorded', stray.noRecord === true)

console.log('\n[14] a habit is missed, never "carried"')
S.fresh(st => {
  st.logFrom = '2026-07-01'
  st.lists.daily.push({ id: 'g', title: 'Gym', done: false, repeat: true, createdAt: '2026-07-01', doneAt: null })
  st.lists.daily.push({ id: 'o', title: 'One off', done: false, repeat: false, createdAt: '2026-07-20', doneAt: null })
})
const mix = S.dayStatus('2026-07-30')
check('the habit counts as missed', mix.missed === 1, JSON.stringify(mix))
check('the one-off counts as carried', mix.carried === 1)
check('open is the sum of both', mix.open === 2)

// ---------------------------------------------------------------------------
console.log('\n[15] a day that has not happened yet is never scored')
S.fresh(st => {
  st.logFrom = '2026-07-01'
  // Today (2026-07-31, per NOW above) still has open items - the exact
  // condition that, without a future guard, would paint every day after it
  // as already having missed them.
  st.lists.daily.push({ id: 'g', title: 'Gym', done: false, repeat: true, createdAt: '2026-07-01', doneAt: null })
  st.lists.daily.push({ id: 'o', title: 'One off', done: false, repeat: false, createdAt: '2026-07-20', doneAt: null })
})
const tomorrow = S.dayStatus('2026-08-01')
check('tomorrow is flagged as unrecorded', tomorrow.noRecord === true)
check('...and claims nothing missed or carried', tomorrow.missed === 0 && tomorrow.carried === 0, JSON.stringify(tomorrow))
check('...and is not "clear" either', tomorrow.clear === false)
const farFuture = S.dayStatus('2027-01-01')
check('nor is a day far in the future', farFuture.noRecord === true)
check('today itself IS scored (not "future")', S.dayStatus('2026-07-31').noRecord === false)

console.log(`\n${fails} failure(s)`)
process.exit(fails ? 1 : 0)
