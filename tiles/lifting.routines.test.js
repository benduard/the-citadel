/**
 * Routine tailoring. Plain node: `node tiles/lifting.routines.test.js`.
 *
 * Two things here fail silently if they break, which is why they are tested:
 *
 *  - A PLANS entry naming an exercise that does not exist produces a routine
 *    whose items cannot be logged, with no error anywhere. [1] walks every
 *    plan against the real library.
 *  - progressionFor() telling him to add weight when he has not actually
 *    plateaued is worse than saying nothing at all. [3] and [4] pin down when
 *    it must stay quiet.
 */
const fs = require('fs')
const vm = require('vm')
const path = require('path')
const src = fs.readFileSync(path.join(__dirname, 'lifting.html'), 'utf8')

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
function block(startRe) {
  const at = src.search(startRe)
  if (at === -1) throw new Error('not found: ' + startRe)
  const sq = src.indexOf('[', at), cu = src.indexOf('{', at)
  const i0 = (sq !== -1 && sq < cu) ? sq : cu
  const open = src[i0], close = open === '[' ? ']' : '}'
  let depth = 0, end = i0
  for (let i = i0; i < src.length; i++) {
    if (src[i] === open) depth++
    else if (src[i] === close) { depth--; if (!depth) { end = i + 1; break } }
  }
  return src.slice(i0, end)
}

const NOW = new Date(2026, 7, 1) // Sat 2026-08-01
const sandbox = { console }
sandbox.Date = class extends Date {
  constructor(...a) { if (!a.length) super(NOW.getTime()); else super(...a) }
}
vm.createContext(sandbox)
vm.runInContext(`
  var MUSCLES = ${block(/var MUSCLES\s*=/)};
  var RAW = ${block(/var RAW\s*=/)};
  var PLANS = ${block(/var PLANS\s*=/)};
  var UNI_EXERCISES = ${block(/var UNI_EXERCISES\s*=/)};
  function mkEx(r){
    return { name:r[0], pri:r[1], sec:r[2]?r[2].split(','):[], cat:r[3],
             pat:r[4], bwf:r[5], w:r[6], lad:r[7], uni:!!UNI_EXERCISES[r[0]], custom:false };
  }
  var LIB = RAW.map(mkEx);
  var S = { days:{}, deloads:{}, bw:80 };
  function findEx(n){ for (var i=0;i<LIB.length;i++) if (LIB[i].name===n) return LIB[i]; return null; }
  function dayKey(d){
    var m = String(d.getMonth()+1); if (m.length<2) m='0'+m;
    var day = String(d.getDate()); if (day.length<2) day='0'+day;
    return d.getFullYear()+'-'+m+'-'+day;
  }
  ${grab('today')}
  ${grab('fromKey')}
  ${grab('weekKey')}
  ${grab('sortedDays')}
  ${grab('isDeloadWeek')}
  ${grab('progressionFor')}
`, sandbox)

const S = sandbox
let fails = 0
const check = (label, cond, extra) => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${cond || extra === undefined ? '' : '  -> ' + extra}`)
  if (!cond) fails++
}
const set = (ex, kg, reps) => ({ ex, kg, reps })

// ---------------------------------------------------------------------------
console.log('\n[1] every plan names exercises that actually exist')
let bad = []
S.PLANS.forEach(p => p.routines.forEach(r => r.items.forEach(it => {
  if (!S.findEx(it[0])) bad.push(`${p.id}/${r.name}: ${it[0]}`)
})))
check('no plan references a missing exercise', bad.length === 0, bad.join('; '))
S.PLANS.forEach(p => p.routines.forEach(r => r.items.forEach(it => {
  if (!(it[1] > 0) || !(it[2] > 0)) bad.push(`${p.id}/${r.name}/${it[0]} sets=${it[1]} reps=${it[2]}`)
})))
check('every item has real sets and reps', bad.length === 0, bad.join('; '))

console.log('\n[2] the plan matching his actual split')
const mine = S.PLANS.filter(p => p.id === 'ruben3')[0]
check('it exists', !!mine)
check('and it is offered first', S.PLANS[0].id === 'ruben3', S.PLANS[0].id)
const names = mine.routines.map(r => r.name)
check('legs day', names.indexOf('Legs') !== -1, names.join(', '))
check('chest and shoulders with abs', names.indexOf('Chest & Shoulders + Abs') !== -1)
check('back and arms', names.indexOf('Back & Arms') !== -1)
check('neck as its own short day', names.indexOf('Neck') !== -1)
const legsEx = mine.routines.filter(r => r.name === 'Legs')[0].items.map(i => i[0])
const pushEx = mine.routines.filter(r => r.name === 'Chest & Shoulders + Abs')[0].items.map(i => i[0])
const pullEx = mine.routines.filter(r => r.name === 'Back & Arms')[0].items.map(i => i[0])
check('legs uses his machines', legsEx.includes('Hack Squat') && legsEx.includes('Lying Hamstring Curl'))
check('abs are on the chest day, as his split has them',
  pushEx.includes('Weighted Crunch') || pushEx.includes('Hanging Leg Raise'))
check('arms are on the back day', pullEx.includes('Machine Preacher Curl'))
check('no exercise is repeated inside one day',
  mine.routines.every(r => new Set(r.items.map(i => i[0])).size === r.items.length))

console.log('\n[3] "ready for more weight" only fires on a real plateau')
const threeSame = {
  '2026-07-20': [set('Back Squat', 100, 5)],
  '2026-07-23': [set('Back Squat', 100, 5)],
  '2026-07-27': [set('Back Squat', 100, 6)]
}
S.S.days = threeSame
let p = S.progressionFor('Back Squat')
check('three sessions at the same weight, reps holding -> suggests', !!p)
check('it reports the weight it stalled at', p && p.kg === 100, p && String(p.kg))
check('a heavy compound steps up 5kg', p && p.step === 5, p && String(p.step))
check('it reports the last session reps', p && p.reps === 6, p && String(p.reps))

S.S.days = {
  '2026-07-20': [set('Barbell Curl', 30, 10)],
  '2026-07-23': [set('Barbell Curl', 30, 10)],
  '2026-07-27': [set('Barbell Curl', 30, 11)]
}
check('an isolation lift steps up 2.5kg', S.progressionFor('Barbell Curl').step === 2.5)

console.log('\n[4] and it stays QUIET when there is no plateau')
S.S.days = { '2026-07-20': [set('Back Squat', 100, 5)], '2026-07-23': [set('Back Squat', 100, 5)] }
check('only two sessions -> nothing claimed', S.progressionFor('Back Squat') === null)

S.S.days = {
  '2026-07-20': [set('Back Squat', 95, 5)],
  '2026-07-23': [set('Back Squat', 100, 5)],
  '2026-07-27': [set('Back Squat', 105, 5)]
}
check('weight already climbing -> no suggestion', S.progressionFor('Back Squat') === null)

S.S.days = {
  '2026-07-20': [set('Back Squat', 100, 8)],
  '2026-07-23': [set('Back Squat', 100, 7)],
  '2026-07-27': [set('Back Squat', 100, 5)]
}
check('reps going BACKWARDS is not a plateau, it is fatigue -> quiet',
  S.progressionFor('Back Squat') === null)

S.S.days = {
  '2026-07-20': [set('Pull Up', 0, 8)],
  '2026-07-23': [set('Pull Up', 0, 8)],
  '2026-07-27': [set('Pull Up', 0, 9)]
}
check('pure bodyweight has no load to add -> quiet', S.progressionFor('Pull Up') === null)
check('an exercise never trained -> quiet', S.progressionFor('Deadlift') === null)
check('no exercise at all -> quiet, not a crash', S.progressionFor('') === null)

console.log('\n[5] a deload week never triggers a suggestion')
S.S.days = {
  '2026-07-20': [set('Back Squat', 100, 5)],
  '2026-07-23': [set('Back Squat', 100, 5)],
  '2026-07-27': [set('Back Squat', 100, 6)]
}
S.S.deloads = {}
check('normally it suggests', !!S.progressionFor('Back Squat'))
// 2026-07-27 is a Monday, so its own week key is itself.
S.S.deloads = { [S.weekKey('2026-07-27')]: true }
check('marking that week silences it', S.progressionFor('Back Squat') === null)
check('isDeloadWeek reads any day in the week',
  S.isDeloadWeek('2026-07-29') === true && S.isDeloadWeek('2026-07-20') === false)
S.S.deloads = {}

console.log('\n[6] today is never counted as one of the three')
S.S.days = {
  '2026-07-20': [set('Back Squat', 100, 5)],
  '2026-07-23': [set('Back Squat', 100, 5)],
  '2026-08-01': [set('Back Squat', 100, 6)]   // today
}
check('two past sessions plus today -> not enough', S.progressionFor('Back Squat') === null)

console.log('\n[7] the top set is the heaviest, not the last')
S.S.days = {
  '2026-07-20': [set('Back Squat', 60, 10), set('Back Squat', 100, 5), set('Back Squat', 60, 10)],
  '2026-07-23': [set('Back Squat', 100, 5), set('Back Squat', 60, 12)],
  '2026-07-27': [set('Back Squat', 100, 6), set('Back Squat', 60, 12)]
}
p = S.progressionFor('Back Squat')
check('warm-up sets do not become the plateau weight', !!p && p.kg === 100, p && String(p.kg))
check('and reps come from the top set, not the back-offs', !!p && p.reps === 6, p && String(p.reps))

console.log('\n[8] reordering is wired, and only swaps')
check('up and down controls exist', /data-iup/.test(src) && /data-idown/.test(src))
check('the handler is a plain swap, not a splice',
  /var tmp = ro\.items\[i0\]; ro\.items\[i0\] = ro\.items\[i1\]; ro\.items\[i1\] = tmp;/.test(src))
check('it refuses to move past either end', /if \(i1 >= 0 && i1 < ro\.items\.length\)/.test(src))
check('the ends have their buttons disabled',
  /up\.disabled = idx === 0/.test(src) && /dn\.disabled = idx === r\.items\.length - 1/.test(src))

console.log('\n[9] the suggestion never acts on its own')
const rl = grab('renderLast')
check('it only writes markup, never a set or a weight box',
  /html \+= '<div class="ltNote prog">/.test(rl) &&
  !/fKg'\)\.value =/.test(rl))

console.log(`\n${fails} failure(s)`)
process.exit(fails ? 1 : 0)
