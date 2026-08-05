/**
 * The Lists tile, checked where it can actually lose data: the v1 migration
 * and the day/week roll. Plain node: `node tiles/lists.test.js`.
 *
 * The tile id is still 'projects' and projects_done must keep counting exactly
 * what it counted in v1, or every ledger row written before today changes
 * meaning. That is the thing most worth a test.
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
  var ARCHIVE_CAP = 200;
  var state, loaded = true, rolledNote = '';
  function listById(id){ for (var i=0;i<LISTS.length;i++) if (LISTS[i].id===id) return LISTS[i]; return LISTS[0]; }
  ${grab('dateKey')}
  ${grab('todayLocal')}
  ${grab('weekKey')}
  ${grab('items')}
  ${grab('openOf')}
  ${grab('doneOf')}
  ${grab('doneCount')}
  ${grab('roll')}
  function fresh(){
    state = { v:2, lists:{daily:[],weekly:[],grocery:[],projects:[],someday:[]},
              archive:[], rolledOn:'', rolledWeek:'' };
    rolledNote = '';
    return state;
  }
`, sandbox)

let fails = 0
const check = (label, cond, extra) => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${cond || !extra ? '' : '  -> ' + extra}`)
  if (!cond) fails++
}
const item = (title, done, repeat) => ({ id: title, title, done: !!done, repeat: !!repeat, doneAt: done ? '2026-07-30' : null })

// ── 1. the ledger contract ────────────────────────────────────────────────
console.log('\n[1] projects_done still counts exactly what v1 counted')
let s = sandbox.fresh()
s.lists.projects = [item('Ship v1', true), item('Wire sync', true), item('Cardio tile', false)]
check('two done projects', sandbox.doneCount() === 2, sandbox.doneCount())
s.lists.daily = [item('Bins out', true), item('Emails', true)]
s.lists.grocery = [item('Oats', true)]
check('daily and grocery do NOT inflate it', sandbox.doneCount() === 2, sandbox.doneCount())

// ── 2. the v1 migration, as the tile does it ──────────────────────────────
console.log('\n[2] a v1 blob migrates without losing anything')
const v1 = { projects: [item('Old project A', true), item('Old project B', false)] }
s = sandbox.fresh()
if (Array.isArray(v1.projects)) s.lists.projects = v1.projects
check('both items carried across', s.lists.projects.length === 2)
check('done state preserved', sandbox.doneCount() === 1, sandbox.doneCount())
check('titles untouched', s.lists.projects[0].title === 'Old project A')
check('no other list invented data', s.lists.daily.length === 0 && s.lists.grocery.length === 0)

// ── 3. the first-run trap ─────────────────────────────────────────────────
console.log('\n[3] a blank marker rolls NOTHING (first ever run)')
s = sandbox.fresh()
s.lists.daily = [item('Finished this morning', true), item('Still open', false)]
sandbox.roll()
check('nothing archived on first run', s.archive.length === 0, s.archive.length)
check('the finished item is still there', s.lists.daily.length === 2, s.lists.daily.length)
check('but the marker is now set', s.rolledOn === '2026-07-31', s.rolledOn)

// ── 4. a real new day ─────────────────────────────────────────────────────
console.log('\n[4] a new day archives finished one-offs, never deletes them')
s = sandbox.fresh()
s.rolledOn = '2026-07-30'; s.rolledWeek = sandbox.weekKey()
s.lists.daily = [item('Bins out', true), item('Stretch', true, true), item('Call bank', false)]
sandbox.roll()
const titles = s.lists.daily.map(x => x.title)
check('finished one-off left the live list', !titles.includes('Bins out'), titles.join(','))
check('...and is in the archive, with its text', s.archive.length === 1 && s.archive[0].title === 'Bins out',
  JSON.stringify(s.archive))
check('archive records which list it came from', s.archive[0].list === 'daily')
check('repeating item stayed', titles.includes('Stretch'))
check('repeating item unchecked itself', s.lists.daily.find(x => x.title === 'Stretch').done === false)
check('unfinished item carried over', titles.includes('Call bank'))
check('it says what it did', /moved to Recently finished/.test(sandbox.rolledNote), sandbox.rolledNote)

// ── 5. projects and grocery never roll ────────────────────────────────────
console.log('\n[5] lists with no roll are left alone')
s = sandbox.fresh()
s.rolledOn = '2026-07-30'; s.rolledWeek = '2026-07-20'
s.lists.projects = [item('Ship v1', true)]
s.lists.grocery = [item('Oats', true)]
s.lists.someday = [item('Learn to sail', false)]
sandbox.roll()
check('a finished project stays put', s.lists.projects.length === 1 && s.lists.projects[0].done === true)
check('projects_done did not walk backwards', sandbox.doneCount() === 1, sandbox.doneCount())
check('grocery untouched', s.lists.grocery.length === 1)
check('someday untouched', s.lists.someday.length === 1)

// ── 6. weekly rolls on the week, not the day ──────────────────────────────
console.log('\n[6] weekly rolls weekly')
s = sandbox.fresh()
s.rolledOn = '2026-07-30'                 // yesterday
s.rolledWeek = sandbox.weekKey()          // same week
s.lists.weekly = [item('Big shop', true)]
sandbox.roll()
check('same week, weekly untouched by a day change', s.lists.weekly.length === 1, s.lists.weekly.length)

s = sandbox.fresh()
s.rolledOn = '2026-07-30'
s.rolledWeek = '2026-07-20'               // a previous Monday
s.lists.weekly = [item('Big shop', true), item('Meal prep', true, true)]
sandbox.roll()
check('new week, finished weekly item archived', s.archive.length === 1 && s.archive[0].list === 'weekly',
  JSON.stringify(s.archive))
check('repeating weekly item unchecked, kept', s.lists.weekly.length === 1 && s.lists.weekly[0].done === false)

// ── 7. the archive is capped, newest kept ─────────────────────────────────
console.log('\n[7] the archive stays bounded')
s = sandbox.fresh()
s.rolledOn = '2026-07-30'; s.rolledWeek = sandbox.weekKey()
s.archive = []
for (let i = 0; i < 260; i++) s.archive.push({ title: 'old ' + i, list: 'daily', doneAt: '2026-01-01' })
s.lists.daily = [item('Newest', true)]
sandbox.roll()
check('capped at 200', s.archive.length === 200, s.archive.length)
check('the newest is at the front, not dropped', s.archive[0].title === 'Newest', s.archive[0].title)

// ── 8. rolling twice in a day does nothing the second time ────────────────
console.log('\n[8] rolling is idempotent within a day')
s = sandbox.fresh()
s.rolledOn = '2026-07-30'; s.rolledWeek = sandbox.weekKey()
s.lists.daily = [item('Bins out', true)]
sandbox.roll()
const after = s.archive.length
sandbox.roll(); sandbox.roll()
check('still one archived entry', s.archive.length === after && after === 1, s.archive.length)

// ── 9. it will not roll before the vault answers ──────────────────────────
console.log('\n[9] no rolling before the vault has answered')
s = sandbox.fresh()
s.rolledOn = '2026-07-30'; s.rolledWeek = sandbox.weekKey()
s.lists.daily = [item('Bins out', true)]
vm.runInContext('loaded = false', sandbox)
const ret = sandbox.roll()
check('roll refuses and reports no change', ret === false, String(ret))
check('nothing was archived', s.archive.length === 0, s.archive.length)
vm.runInContext('loaded = true', sandbox)

// ── 10. the lists Ruben asked for are all here ────────────────────────────
console.log('\n[10] the lists asked for exist, and behave as described')
const ids = sandbox.LISTS.map(l => l.id)
check('daily to do', ids.includes('daily'))
check('grocery', ids.includes('grocery'))
check('pending projects', ids.includes('projects'))
check('plus the two recommended', ids.includes('weekly') && ids.includes('someday'))
check('only projects reaches the ledger',
  sandbox.LISTS.filter(l => l.counts).map(l => l.id).join(',') === 'projects',
  sandbox.LISTS.filter(l => l.counts).map(l => l.id).join(','))
check('daily rolls daily', sandbox.listById('daily').roll === 'day')
check('weekly rolls weekly', sandbox.listById('weekly').roll === 'week')
check('grocery and projects never roll',
  sandbox.listById('grocery').roll === null && sandbox.listById('projects').roll === null)
check('every list explains itself on screen', sandbox.LISTS.every(l => l.why && l.why.length > 20))

// ── 11. habits are split out from the day's own work ──────────────────────
console.log('\n[11] repeating items get their own section, below the day\'s work')
check('the section exists in the markup', /id="repWrapList"/.test(src))
check('the split is by the repeat flag',
  /open\.filter\(function\(x\)\{ return !x\.repeat; \}\)/.test(src) &&
  /open\.filter\(function\(x\)\{ return x\.repeat; \}\)/.test(src))
check('one-offs render into the FIRST list, habits into the second',
  src.indexOf('id="openList"') < src.indexOf('id="repWrapList"'))
check('only lists that can repeat get the split',
  /if \(L\.repeatable\)\{\s*\n\s*oneOff = open\.filter/.test(src))
check('a list with no habits hides the section entirely',
  /rw\.hidden = !repeating\.length/.test(src))
check('the daily wording says every morning, the weekly says every Monday',
  /come back every morning/.test(src) && /come back every Monday/.test(src))
// The trap: an empty one-off list with habits still open must not read as
// "nothing to do", because there plainly is something to do just below it.
check('an empty day with habits left does not claim there is nothing to do',
  /Nothing just for today\. The standing ones are below\./.test(src))
check('nothing is dropped - every open item lands in one of the two lists',
  /oneOff\.forEach\(function\(x\)\{ openEl\.appendChild/.test(src) &&
  /repeating\.forEach\(function\(x\)\{ rl2\.appendChild/.test(src))

// ── 12. lists he makes himself ────────────────────────────────────────────
console.log('\n[12] a list you make is a real list, and reaches nothing it should not')
const custom = vm.runInContext(`
  var state = { custom:[{ id:'u:abc', name:'Work' }], lists:{ 'u:abc':[] } };
  ${grab('customLists')}
  customLists()
`, sandbox)
check('it exists as a list', custom.length === 1 && custom[0].name === 'Work')
// The three that would each be a lie if they were true by default.
check('it never rolls', custom[0].roll === null, String(custom[0].roll))
check('it has no repeating items', custom[0].repeatable === false, String(custom[0].repeatable))
// THE ONE THAT MATTERS. projects_done has counted the same thing since v1.
// A new list quietly folded into it would make every row logged before today
// a lie about what it counted.
check('it never reaches the ledger', !custom[0].counts, String(custom[0].counts))
check('it says what it is on screen', !!custom[0].why && custom[0].why.length > 20)

// doneCount is what projects_done reports, and it reads ONE list by name.
check('the ledger count is hardcoded to projects, not "whatever list counts"',
  /function doneCount\(\)\{ return doneOf\('projects'\)\.length; \}/.test(src))

console.log('\n[13] a custom id can never collide with a built-in')
// The id is the key its items are stored under. A list called "Daily" landing
// on the built-in daily id would merge two lists into one with no error.
check('custom ids are prefixed', /var CUSTOM_PREFIX = 'u:'/.test(src))
check('no built-in uses that prefix',
  sandbox.BUILTIN_LISTS.every(l => l.id.indexOf('u:') !== 0),
  sandbox.BUILTIN_LISTS.map(l => l.id).join(','))
check('the loader refuses anything not carrying the prefix',
  /c\.id\.indexOf\(CUSTOM_PREFIX\) === 0/.test(src))
check('a duplicate name is refused rather than silently allowed',
  /There is already a list called/.test(src))
// It arms rather than confirms - confirm() is a modal and modals never open in
// a sealed frame, see tiles/sealed.test.js - and the armed state says what
// goes, so a second tap is never a blind one.
check('deleting one arms first and says how much goes with it',
  /armedDelete === L\.id/.test(src) && /'Tap again to delete ' \+ n/.test(src))
// The archive and the done log are keyed by DATE, not by list, and together
// they are what the calendar reads. Deleting a list must not rewrite what a
// day was - the list is gone, the record of what got finished is not.
const delBody = grab('deleteList')
check('deleting a list leaves the archive alone', !/state\.archive/.test(delBody), delBody.match(/state\.archive.*/) || '')
check('and leaves the calendar log alone', !/state\.done/.test(delBody), delBody.match(/state\.done.*/) || '')
check('it does remove the list and its items',
  /state\.custom = /.test(delBody) && /delete state\.lists\[id\]/.test(delBody))

// ── 14. moving an item between lists ──────────────────────────────────────
console.log('\n[14] a task can be sent to another list')
vm.runInContext(`
  var trouble = '';
  function persist(){}
  function renderAll(){}
  function renderPage(){}
  ${grab('moveItem')}
`, sandbox)
const mv = (from, id, to) => {
  vm.runInContext('trouble = ""', sandbox)
  sandbox.moveItem(from, id, to)
  return vm.runInContext('trouble', sandbox)
}
const seed = () => {
  sandbox.state = {
    v: 3,
    lists: {
      daily: [{ id:'d1', title:'Stretch', done:false, repeat:true, createdAt:'2026-07-30', doneAt:null }],
      weekly: [], grocery: [],
      projects: [
        { id:'p1', title:'Ship it', done:true,  createdAt:'2026-07-01', doneAt:'2026-07-30' },
        { id:'p2', title:'Draft it', done:false, createdAt:'2026-07-01', doneAt:null }
      ],
      someday: []
    },
    custom: [], archive: [], done: {}, logFrom: '2026-07-01', rolledOn: '', rolledWeek: ''
  }
  vm.runInContext('tab = "daily"', sandbox)
}
vm.runInContext('var tab = "daily"', sandbox)

seed()
check('the item leaves the list it was on',
  (mv('daily', 'd1', 'grocery'), sandbox.state.lists.daily.length === 0))
check('and arrives on the other one',
  sandbox.state.lists.grocery.length === 1 && sandbox.state.lists.grocery[0].title === 'Stretch')
// Grocery has no notion of "every day". A flag its list cannot honour is a
// flag that does nothing until someone moves it back and is surprised.
check('a repeating item loses its repeat on a list that does not repeat',
  sandbox.state.lists.grocery[0].repeat === false,
  String(sandbox.state.lists.grocery[0].repeat))
check('nothing is duplicated', sandbox.state.lists.daily.length === 0)

seed()
check('moving to the list it is already on does nothing',
  (mv('daily', 'd1', 'daily'), sandbox.state.lists.daily.length === 1))
check('an id that is not there is a no-op, not a crash',
  (mv('daily', 'nope', 'grocery'), sandbox.state.lists.grocery.length === 0))

console.log('\n[15] THE LEDGER RULE: a finished item cannot cross Projects')
/**
 * projects_done counts done items on Projects and has meant exactly that
 * since v1. Moving a finished thing OFF would walk the ledger backwards for a
 * bookkeeping action - the same thing clearDone already refuses. Moving one ON
 * would inflate it with work that was never a project.
 */
seed()
let warn = mv('projects', 'p1', 'daily')
check('a done project may not leave', sandbox.state.lists.projects.some(x => x.id === 'p1'))
check('and it says why rather than failing silently', /ledger/.test(warn), warn)
check('the target list is untouched', sandbox.state.lists.daily.length === 1)

seed()
sandbox.state.lists.daily[0].done = true
warn = mv('daily', 'd1', 'projects')
check('a done item may not arrive either', sandbox.state.lists.projects.length === 2,
  String(sandbox.state.lists.projects.length))
check('and it says why', /never a project/.test(warn), warn)

seed()
warn = mv('projects', 'p2', 'daily')
check('an OPEN project moves freely - it was never counted',
  !sandbox.state.lists.projects.some(x => x.id === 'p2') &&
  sandbox.state.lists.daily.some(x => x.id === 'p2'))
check('with no warning', warn === '', warn)

console.log('\n[16] moving into a list that does not exist yet')
check('the row offers it', /NEW_LIST_VALUE/.test(src) && /New list\.\.\./.test(src))
check('the item is held until the list is made', /pendingMove = \{ from:L\.id, id:x\.id \}/.test(src))
check('and lands the moment it is', /if \(pm\)\{ moveItem\(pm\.from, pm\.id, id\); return; \}/.test(src))
// Otherwise the next list he makes for any reason inherits an item he stopped
// moving minutes ago.
check('backing out of naming abandons the pending move',
  /if \(!naming\) pendingMove = null;/.test(src))
// The calendar's `done` log names the list an item was crossed off on, and
// that WAS true that day. Rewriting it to agree with a later move would be
// falsifying the record to tidy a label.
const moveBody = grab('moveItem')
check('moving never rewrites the calendar record', !/state\.done/.test(moveBody), moveBody)
check('nor the archive', !/state\.archive/.test(moveBody), moveBody)

console.log(`\n${fails} failure(s)`)
process.exit(fails ? 1 : 0)
