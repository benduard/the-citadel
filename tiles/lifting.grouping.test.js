/**
 * "Group completed sets by body part," checked against tiles/lifting.html
 * itself. Plain node: `node tiles/lifting.grouping.test.js`.
 */
const fs = require('fs')
const vm = require('vm')
const path = require('path')
const src = fs.readFileSync(path.join(__dirname, 'lifting.html'), 'utf8')

function grab(name) {
  const re = new RegExp(`\\n  function ${name}\\(`)
  const at = src.search(re)
  if (at === -1) throw new Error('could not find ' + name)
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

const sandbox = { console }
vm.createContext(sandbox)
vm.runInContext(`
  var MUSCLES = ${grabVar('MUSCLES', '{')};
  function findEx(n){ return EXDB[n] || null; }
  var EXDB = {
    'Back Squat': { pri:'quads', bwf:0 },
    'Leg Curl': { pri:'hams', bwf:0 },
    'Barbell Bench Press': { pri:'chest', bwf:0 },
    'Pull Up': { pri:'lats', bwf:1 }
  };
  ${grab('groupByMuscle')}
`, sandbox)

let fails = 0
const check = (label, cond, extra) => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${cond || !extra ? '' : '  -> ' + extra}`)
  if (!cond) fails++
}

const s = (ex, id) => ({ id, ex, kg: 100, reps: 5 })

console.log('\n[1] mixed day groups into the right buckets, nothing dropped')
const day = [s('Back Squat', 1), s('Barbell Bench Press', 2), s('Back Squat', 3), s('Leg Curl', 4), s('Pull Up', 5)]
const groups = sandbox.groupByMuscle(day)
const total = groups.reduce((n, g) => n + g.sets.length, 0)
check('every set is accounted for', total === day.length, `${total} vs ${day.length}`)
const quads = groups.find(g => g.muscle === 'quads')
check('both squats land in quads', quads && quads.sets.length === 2, JSON.stringify(quads))
check('order within a bucket is preserved (set 1 before set 3)',
  quads.sets[0].id === 1 && quads.sets[1].id === 3)
const chest = groups.find(g => g.muscle === 'chest')
check('bench lands in chest, alone', chest && chest.sets.length === 1)

console.log('\n[2] bucket order follows MUSCLES, not first-seen-in-the-day')
const muscleOrder = Object.keys(sandbox.MUSCLES)
const groupOrder = groups.map(g => g.muscle)
let inOrder = true
for (let i = 1; i < groupOrder.length; i++) {
  if (muscleOrder.indexOf(groupOrder[i]) < muscleOrder.indexOf(groupOrder[i - 1])) inOrder = false
}
check('groups appear in MUSCLES order regardless of log order', inOrder, groupOrder.join(','))

console.log('\n[3] an exercise this board cannot find still shows up somewhere')
const withGhost = [s('Back Squat', 1), s('Some Deleted Custom Exercise', 2)]
const groups2 = sandbox.groupByMuscle(withGhost)
const total2 = groups2.reduce((n, g) => n + g.sets.length, 0)
check('nothing silently vanishes', total2 === 2, total2)

console.log('\n[4] an empty day groups into nothing, not an error')
check('empty day -> empty groups', sandbox.groupByMuscle([]).length === 0)

console.log(`\n${fails} failure(s)`)
process.exit(fails ? 1 : 0)
