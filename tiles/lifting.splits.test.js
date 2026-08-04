/**
 * The split selector, checked against the real exercise library in
 * tiles/lifting.html. Plain node: `node tiles/lifting.splits.test.js`.
 *
 * The invariant worth guarding is the coverage one. SPLITS is meant to be
 * edited by hand, and the failure mode is silent: drop a muscle and every
 * exercise that trains it disappears from every split with no error anywhere.
 */
const fs = require('fs')
const vm = require('vm')
const path = require('path')
const src = fs.readFileSync(path.join(__dirname, 'lifting.html'), 'utf8')

function block(startRe) {
  const at = src.search(startRe)
  if (at === -1) throw new Error('not found: ' + startRe)
  let i = src.indexOf('[', at) >= 0 && src.indexOf('[', at) < src.indexOf('{', at) === false
    ? src.indexOf('{', at) : src.indexOf('[', at)
  // simple bracket walk from the first [ or { after the name
  const open = src[i], close = open === '[' ? ']' : '}'
  let depth = 0, end = i
  for (; i < src.length; i++) {
    if (src[i] === open) depth++
    else if (src[i] === close) { depth--; if (!depth) { end = i + 1; break } }
  }
  return src.slice(src.indexOf(open, at), end)
}

const sandbox = { console }
vm.createContext(sandbox)
vm.runInContext(`
  var MUSCLES = ${block(/var MUSCLES\s*=/)};
  var SPLITS = ${block(/var SPLITS\s*=/)};
  var RAW = ${block(/var RAW\s*=/)};
  var RETIRED = ${block(/var RETIRED_EXERCISES\s*=/)};
  function mkEx(r){
    return { name:r[0], pri:r[1], sec:r[2]?r[2].split(','):[], cat:r[3],
             pat:r[4], bwf:r[5], w:r[6], lad:r[7], custom:false };
  }
  var LIB = RAW.map(mkEx);
  function splitById(id){ for (var i=0;i<SPLITS.length;i++) if (SPLITS[i].id===id) return SPLITS[i]; return null; }
`, sandbox)

const { MUSCLES, SPLITS, LIB, RETIRED } = sandbox
let fails = 0
const check = (label, cond, extra) => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${cond || !extra ? '' : '  -> ' + extra}`)
  if (!cond) fails++
}

console.log('\n[1] the split matches what Ruben actually trains')
check('four splits', SPLITS.length === 4, SPLITS.length)
check('legs', !!sandbox.splitById('legs'))
check('chest and shoulders + abs', !!sandbox.splitById('push'))
check('back and arms', !!sandbox.splitById('pull'))
check('neck, its own always-available section', !!sandbox.splitById('neck'))

console.log('\n[2] THE INVARIANT: every muscle in exactly one split')
const all = Object.keys(MUSCLES)
const seen = {}
SPLITS.forEach(s => s.mus.forEach(m => { seen[m] = (seen[m] || 0) + 1 }))
const missing = all.filter(m => !seen[m])
const twice = all.filter(m => seen[m] > 1)
const unknown = Object.keys(seen).filter(m => all.indexOf(m) === -1)
check('no muscle left out of every split', missing.length === 0, missing.join(', '))
check('no muscle on two different days', twice.length === 0, twice.join(', '))
check('no split names a muscle that does not exist', unknown.length === 0, unknown.join(', '))

console.log('\n[3] every exercise is reachable from some split')
const orphans = LIB.filter(e => !SPLITS.some(s => s.mus.indexOf(e.pri) !== -1))
check(`all ${LIB.length} library exercises land on a day`, orphans.length === 0,
  orphans.map(e => `${e.name} (${e.pri})`).join(', '))

console.log('\n[4] no exercise appears on two days')
const dupes = LIB.filter(e => SPLITS.filter(s => s.mus.indexOf(e.pri) !== -1).length > 1)
check('each exercise belongs to exactly one day', dupes.length === 0, dupes.map(e => e.name).join(', '))

console.log('\n[5] each day has real work in it')
// Neck is an accessory section, not a training day on its own - it will
// never have a "serious lift to build on" the way a squat or a bench does,
// so it is held to a lighter bar: real exercises exist, full stop.
SPLITS.forEach(s => {
  const forDay = LIB.filter(e => s.mus.indexOf(e.pri) !== -1)
  if (s.id === 'neck'){
    check(`${s.name}: has real exercises`, forDay.length >= 2, String(forDay.length))
    return
  }
  const compounds = forDay.filter(e => e.w >= 2)
  check(`${s.name}: ${forDay.length} exercises`, forDay.length >= 5, String(forDay.length))
  check(`${s.name}: has serious lifts to build on`, compounds.length >= 2, String(compounds.length))
})

console.log('\n[6] the day the ask described, in full')
const legs = LIB.filter(e => sandbox.splitById('legs').mus.indexOf(e.pri) !== -1).map(e => e.name)
const push = LIB.filter(e => sandbox.splitById('push').mus.indexOf(e.pri) !== -1).map(e => e.name)
const pull = LIB.filter(e => sandbox.splitById('pull').mus.indexOf(e.pri) !== -1).map(e => e.name)
check('squats are on leg day', legs.includes('Back Squat'))
check('calf raises are on leg day', legs.includes('Standing Calf Raise'))
check('bench is on chest day', push.includes('Barbell Bench Press'))
check('overhead press is on chest/shoulder day', push.includes('Overhead Press'))
check('abs are on chest/shoulder day, as asked', push.includes('Hanging Leg Raise') && push.includes('Cable Crunch'))
check('abs are NOT on leg day', !legs.includes('Cable Crunch'))
check('rows are on back day', pull.includes('Barbell Row'))
check('curls are on back/arms day', pull.includes('Barbell Curl'))
check('triceps are on back/arms day, not chest day',
  pull.includes('Cable Triceps Pushdown') && !push.includes('Cable Triceps Pushdown'))
check('deadlift is on back day', pull.includes('Deadlift'))
check('romanian deadlift is on leg day (hamstrings)', legs.includes('Romanian Deadlift'))

console.log('\n[7] biggest lift first inside a muscle')
const quads = LIB.filter(e => e.pri === 'quads')
  .sort((a, b) => (b.w || 0) - (a.w || 0) || a.name.localeCompare(b.name))
check('Back Squat leads the quads group', quads[0].name === 'Back Squat', quads[0].name)

console.log('\n[8] the real machines Ruben listed land on the right day')
const names = LIB.map(e => e.name)
;['Pendulum Squat','Hack Squat','Seated Calf Raise','Seated Hamstring Curl',
  'Lying Hamstring Curl','Hip Adduction Machine','Hip Abduction Machine'].forEach(n =>
  check(`${n} is on leg day`, legs.includes(n)))
;['Dumbbell Flat Press','Incline Plate-Loaded Machine Press','Decline Plate-Loaded Machine Press',
  'Plate-Loaded Machine Shoulder Press','Standing Machine Lateral Raise','Seated Machine Lateral Raise',
  'Chest Fly Machine','Weighted Crunch'].forEach(n =>
  check(`${n} is on chest/shoulder day`, push.includes(n)))
;['Chest Supported T-Bar Row','Rear Delt Fly Machine','Incline Dumbbell Curl',
  'Machine Preacher Curl','Barbell Preacher Curl','Rope Triceps Pushdown',
  'Cable Reverse Curl','Dumbbell Reverse Curl','Standing Forearm Curl'].forEach(n =>
  check(`${n} is on back/arms day`, pull.includes(n)))
const neckEx = LIB.filter(e => sandbox.splitById('neck').mus.indexOf(e.pri) !== -1).map(e => e.name)
;['Weighted Neck Curl','Weighted Neck Extension','Weighted Side Neck Curl'].forEach(n =>
  check(`${n} is in the Neck section`, neckEx.includes(n)))
check('no accidental duplicate of an exercise that already existed',
  names.filter(n => n === 'Leg Extension').length === 1 &&
  names.filter(n => n === 'Standing Calf Raise').length === 1 &&
  names.filter(n => n === 'Skull Crusher').length === 1)

console.log('\n[9] adduction and abduction are two exercises, and the old one is retired not deleted')
// The point of the split: one entry meant one history for two machines at two
// different stacks, so "last time" and the PR were both whichever one he
// happened to do last.
const byName = n => LIB.filter(e => e.name === n)[0]
const add = byName('Hip Adduction Machine'), abd = byName('Hip Abduction Machine')
check('Hip Adduction Machine exists', !!add)
check('Hip Abduction Machine exists', !!abd)
check('they are genuinely two entries, not one renamed', add && abd && add.name !== abd.name)
// Abduction IS glute work. Adduction is the inner thigh, which is why the
// muscle had to exist before the exercise could be filed honestly.
check('abduction trains glutes', abd && abd.pri === 'glutes', abd && abd.pri)
check('adduction trains adductors, not glutes', add && add.pri === 'adductors', add && add.pri)
check('adductors is a real muscle in MUSCLES', !!MUSCLES.adductors)

const old = byName('Adductor/Abductor Machine')
check('the combined entry is still in the library', !!old)
check('it is marked retired', !!(old && RETIRED['Adductor/Abductor Machine']))
// This is the whole reason it was kept. A set stores its exercise as a string,
// so deleting the entry would leave every set already logged under this name
// with no bodyweight fraction, no ladder, no rank and no unit handling - and
// nothing on screen would say so.
check('so findEx can still resolve sets already logged under it',
  !!(old && old.lad && old.lad.length === 9))
check('neither replacement is retired',
  !RETIRED['Hip Adduction Machine'] && !RETIRED['Hip Abduction Machine'])

console.log(`\n${fails} failure(s)`)
process.exit(fails ? 1 : 0)
