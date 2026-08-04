/**
 * Rest length per exercise. Plain node: `node tiles/lifting.rest.test.js`.
 *
 * The tier is derived from `w`, which was calibrated for RANKING rather than
 * for fatigue - so the interesting failure is not "the code is broken", it is
 * "an exercise quietly landed in the wrong tier and nobody noticed". [4] walks
 * the entire library and asserts every single lift gets a tier that makes
 * sense for what it is, which is the check that catches that.
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

const sandbox = { console }
vm.createContext(sandbox)
vm.runInContext(`
  var MUSCLES = ${block(/var MUSCLES\s*=/)};
  var RAW = ${block(/var RAW\s*=/)};
  var UNI_EXERCISES = ${block(/var UNI_EXERCISES\s*=/)};
  var REST_TIERS = ${block(/var REST_TIERS\s*=/)};
  var REST_OVERRIDE = ${block(/var REST_OVERRIDE\s*=/)};
  function mkEx(r){
    return { name:r[0], pri:r[1], sec:r[2]?r[2].split(','):[], cat:r[3],
             pat:r[4], bwf:r[5], w:r[6], lad:r[7], uni:!!UNI_EXERCISES[r[0]], custom:false };
  }
  var LIB = RAW.map(mkEx);
  var S = { rest: 90, restAuto: true };
  function findEx(n){ for (var i=0;i<LIB.length;i++) if (LIB[i].name===n) return LIB[i]; return null; }
  function pad(n){ return n < 10 ? '0' + n : '' + n; }
  ${grab('restFor')}
  ${grab('restWhy')}
  ${grab('fmtRest')}
`, sandbox)

const S = sandbox
let fails = 0
const check = (label, cond, extra) => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${cond || extra === undefined ? '' : '  -> ' + extra}`)
  if (!cond) fails++
}
const T = S.REST_TIERS

// ---------------------------------------------------------------------------
console.log('\n[1] the tiers are the ones asked for')
// Set by Ruben on 2026-08-04: nothing under three minutes, multi-joint gets five.
check('multi-joint lifts rest 5 minutes', T.compound === 300, String(T.compound))
check('isolation rests 3 minutes', T.isolation === 180, String(T.isolation))
check('THE FLOOR: nothing in the whole library rests under 3 minutes',
  S.LIB.every(e => S.restFor(e.name) >= 180),
  S.LIB.filter(e => S.restFor(e.name) < 180).map(e => e.name).join(', '))
check('the old middle tier is gone, not left dangling', T.heavy === undefined)
check('and the two are ordered', T.compound > T.isolation)

console.log('\n[2] multi-joint work gets the long rest')
// Dumbbell Flat Press is named because it is the one he asked for by name -
// it was on the middle tier, treated as a lesser press than the barbell.
;['Back Squat', 'Deadlift', 'Sumo Deadlift', 'Barbell Bench Press', 'Overhead Press',
  'Barbell Row', 'Front Squat', 'Romanian Deadlift', 'Dumbbell Flat Press',
  'Incline Dumbbell Press', 'Lat Pulldown', 'Seated Cable Row', 'Dip', 'Hack Squat',
  'Chest Supported T-Bar Row', 'Plate-Loaded Machine Shoulder Press'].forEach(n =>
  check(`${n} rests ${T.compound}s`, S.restFor(n) === T.compound, String(S.restFor(n))))

console.log('\n[3] isolation gets the floor, which is now three minutes')
;['Barbell Curl', 'Lateral Raise', 'Cable Triceps Pushdown', 'Leg Extension',
  'Seated Calf Raise', 'Rear Delt Fly Machine', 'Standing Forearm Curl',
  'Weighted Neck Curl', 'Cable Crunch', 'Chest Fly Machine'].forEach(n =>
  check(`${n} rests ${T.isolation}s`, S.restFor(n) === T.isolation, String(S.restFor(n))))

console.log('\n[4] EVERY exercise in the library lands in a sane tier')
// The mistake worth catching now is a single-joint lift sitting on the long
// rest, or a multi-joint one on the short. Named by movement rather than by
// listing all 67 by hand, so adding an exercise is covered automatically.
const ISOLATION_WORDS = /curl|raise|extension|fly|pushdown|shrug|crunch|skull|face pull|adductor/i
const COMPOUND_NAMES = /^(Back Squat|Front Squat|Deadlift|Sumo Deadlift|Romanian Deadlift|Barbell Bench Press|Incline Barbell Press|Dumbbell Flat Press|Overhead Press|Barbell Row|Pendlay Row|Pull Up|Chin Up|Dip|Leg Press|Hack Squat|Pendulum Squat|Lat Pulldown|Seated Cable Row)$/
let odd = []
S.LIB.forEach(e => {
  const r = S.restFor(e.name)
  check(`${e.name} -> ${S.fmtRest(r)}`, r === T.compound || r === T.isolation, String(r))
  // Romanian Deadlift and Leg/Lying Hamstring Curl both match ISOLATION_WORDS
  // by name while differing in kind - the hinge is multi-joint, the curls are
  // not - so the hinge is excluded explicitly rather than by a looser regex.
  const looksIsolation = ISOLATION_WORDS.test(e.name) && e.name !== 'Romanian Deadlift'
  if (looksIsolation && r === T.compound) odd.push(`${e.name} (isolation on ${r}s)`)
  if (COMPOUND_NAMES.test(e.name) && r !== T.compound) odd.push(`${e.name} (multi-joint on ${r}s)`)
})
check('no single-joint lift is on the 5 minute rest, and no multi-joint lift is short',
  odd.length === 0, odd.join('; '))

console.log('\n[5] the overrides exist because `w` gets them wrong')
check('Leg Press is w:1 but not treated as isolation',
  S.findEx('Leg Press').w === 1 && S.restFor('Leg Press') === T.compound)
check('Walking Lunge likewise',
  S.findEx('Walking Lunge').w === 1 && S.restFor('Walking Lunge') === T.compound)
check('Push Up is w:1 but presses the same joints as a bench',
  S.findEx('Push Up').w === 1 && S.restFor('Push Up') === T.compound)
check('every override names a real exercise, so none is dead weight',
  Object.keys(S.REST_OVERRIDE).every(n => !!S.findEx(n)),
  Object.keys(S.REST_OVERRIDE).filter(n => !S.findEx(n)).join(', '))
// An override that agrees with the rule is a line someone has to keep in step
// by hand for no benefit. The old heavy-tier overrides became exactly that
// when the tiers collapsed, and this is what catches the next ones.
check('and every override actually changes the answer',
  Object.keys(S.REST_OVERRIDE).every(n => {
    const e = S.findEx(n)
    const derived = e.w >= 2 ? T.compound : T.isolation
    return S.REST_OVERRIDE[n] !== derived
  }),
  Object.keys(S.REST_OVERRIDE).filter(n => {
    const e = S.findEx(n)
    return S.REST_OVERRIDE[n] === (e.w >= 2 ? T.compound : T.isolation)
  }).join(', '))

console.log('\n[6] fixed mode gives back exactly the old behaviour')
S.S.restAuto = false
check('a squat uses his own number', S.restFor('Back Squat') === 90, String(S.restFor('Back Squat')))
check('so does a curl', S.restFor('Barbell Curl') === 90)
check('and the reason says so', /fixed/i.test(S.restWhy('Back Squat')))
S.S.restAuto = true
check('switching back restores the tier', S.restFor('Back Squat') === T.compound)

console.log('\n[7] nothing picked, or a lift that no longer exists')
check('empty selection falls back to his number, not a guessed tier',
  S.restFor('') === 90, String(S.restFor('')))
check('a deleted custom lift does the same', S.restFor('Some Deleted Lift') === 90)

console.log('\n[8] the clock reads right')
check('300 reads 5:00', S.fmtRest(300) === '5:00', S.fmtRest(300))
check('180 reads 3:00', S.fmtRest(180) === '3:00', S.fmtRest(180))
check('120 reads 2:00', S.fmtRest(120) === '2:00', S.fmtRest(120))
check('90 reads 1:30, padded', S.fmtRest(90) === '1:30', S.fmtRest(90))

console.log('\n[9] the timer actually uses it, and the button says so')
check('startRest reads restFor, not S.rest directly',
  /var secs = restFor\(ex\);/.test(src) && /beginRestDisplay\(secs, secs\);/.test(src))
check('the Rest button is labelled with the length',
  /b\.textContent = 'Rest ' \+ fmtRest\(restFor\(ex\)\)/.test(src))
check('and it relabels when the exercise changes',
  /updateWeightLabel\(\);\s*\n\s*updateRestLabel\(\);/.test(src))
check('an older saved blob defaults to the new behaviour',
  /S\.restAuto = d\.restAuto !== false/.test(src))

console.log(`\n${fails} failure(s)`)
process.exit(fails ? 1 : 0)
