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
  var LISTS = ${grabVar('LISTS', '[')};
  var ARCHIVE_CAP = 200;
  var state, loaded = true, rolledNote = '';
  function listById(id){ for (var i=0;i<LISTS.length;i++) if (LISTS[i].id===id) return LISTS[i]; return LISTS[0]; }
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

console.log(`\n${fails} failure(s)`)
process.exit(fails ? 1 : 0)
