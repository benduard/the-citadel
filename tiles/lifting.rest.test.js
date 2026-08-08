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
  var BIG_LIFTS = ${block(/var BIG_LIFTS\s*=/)};
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
// Narrowed 2026-08-04: only squats, deadlifts and FLAT bench get five.
check('the big three rest 5 minutes', T.big === 300, String(T.big))
check('everything else rests 3 minutes', T.standard === 180, String(T.standard))
check('THE FLOOR: nothing in the whole library rests under 3 minutes',
  S.LIB.every(e => S.restFor(e.name) >= 180),
  S.LIB.filter(e => S.restFor(e.name) < 180).map(e => e.name).join(', '))
check('there are exactly two tiers, no leftovers from earlier versions',
  Object.keys(T).sort().join() === 'big,standard', Object.keys(T).join())

console.log('\n[2] every squat, every deadlift, every flat bench')
// Read straight off what he asked for, one lift at a time.
const SQUATS = ['Back Squat', 'Front Squat', 'Hack Squat', 'Pendulum Squat',
                'Goblet Squat', 'Bulgarian Split Squat']
const DEADS = ['Deadlift', 'Sumo Deadlift', 'Romanian Deadlift']
// Close Grip moved OFF this list 2026-08-08, at his request - it is still a
// flat press, but he called it out by name to rest it at three, not five.
const FLAT = ['Barbell Bench Press', 'Dumbbell Bench Press', 'Dumbbell Flat Press']
SQUATS.concat(DEADS).concat(FLAT).forEach(n =>
  check(`${n} rests 5:00`, S.restFor(n) === T.big, S.fmtRest(S.restFor(n))))
check('every squat in the library is covered - none missed',
  S.LIB.filter(e => /squat/i.test(e.name)).every(e => S.restFor(e.name) === T.big),
  S.LIB.filter(e => /squat/i.test(e.name) && S.restFor(e.name) !== T.big).map(e => e.name).join(', '))
check('every deadlift in the library is covered - none missed',
  S.LIB.filter(e => /deadlift/i.test(e.name)).every(e => S.restFor(e.name) === T.big),
  S.LIB.filter(e => /deadlift/i.test(e.name) && S.restFor(e.name) !== T.big).map(e => e.name).join(', '))

console.log('\n[3] everything else is three minutes, including things that feel big')
// The point of narrowing: these are all real compound lifts and they are all
// on three now. Listed explicitly because it is the surprising half.
;['Overhead Press', 'Barbell Row', 'Pendlay Row', 'Pull Up', 'Chin Up', 'Dip',
  'Leg Press', 'Lat Pulldown', 'Seated Cable Row', 'Incline Barbell Press',
  'Incline Dumbbell Press', 'Decline Plate-Loaded Machine Press', 'Hip Thrust',
  'Walking Lunge', 'Push Up', 'Barbell Curl', 'Lateral Raise', 'Leg Extension',
  'Weighted Neck Curl', 'Close Grip Bench Press'].forEach(n =>
  check(`${n} rests 3:00`, S.restFor(n) === T.standard, S.fmtRest(S.restFor(n))))
check('INCLINE is not treated as flat - he said flat bench specifically',
  S.restFor('Incline Barbell Press') === T.standard &&
  S.restFor('Incline Dumbbell Press') === T.standard)
check('CLOSE GRIP moved off the big list 2026-08-08 - still a flat press, called out by name',
  S.restFor('Close Grip Bench Press') === T.standard)

console.log('\n[4] EVERY exercise in the library lands in one of the two tiers')
S.LIB.forEach(e => {
  const r = S.restFor(e.name)
  check(`${e.name} -> ${S.fmtRest(r)}`, r === T.big || r === T.standard, String(r))
})
check('the 5 minute list is exactly as long as the named lifts',
  Object.keys(S.BIG_LIFTS).length === SQUATS.length + DEADS.length + FLAT.length,
  String(Object.keys(S.BIG_LIFTS).length))

console.log('\n[5] the list names real lifts, and nothing else claims five minutes')
check('every name on the list exists in the library',
  Object.keys(S.BIG_LIFTS).every(n => !!S.findEx(n)),
  Object.keys(S.BIG_LIFTS).filter(n => !S.findEx(n)).join(', '))
check('and nothing OFF the list is on five minutes',
  S.LIB.filter(e => S.restFor(e.name) === T.big).every(e => !!S.BIG_LIFTS[e.name]),
  S.LIB.filter(e => S.restFor(e.name) === T.big && !S.BIG_LIFTS[e.name]).map(e => e.name).join(', '))
// A custom lift is not one of the big three by definition - it cannot be, the
// list is by name - so it takes the standard three rather than the Profile
// number, which is the answer for "auto is off" and not for "unknown lift".
check('an unknown or custom lift takes the standard three, not the fixed number',
  S.restFor('Some Custom Lift Of His Own') === T.standard,
  String(S.restFor('Some Custom Lift Of His Own')))

console.log('\n[6] fixed mode gives back exactly the old behaviour')
S.S.restAuto = false
check('a squat uses his own number', S.restFor('Back Squat') === 90, String(S.restFor('Back Squat')))
check('so does a curl', S.restFor('Barbell Curl') === 90)
check('and the reason says so', /fixed/i.test(S.restWhy('Back Squat')))
S.S.restAuto = true
check('switching back restores the tier', S.restFor('Back Squat') === T.big)

console.log('\n[7] nothing picked, or a lift that no longer exists')
// These used to fall back to the Profile number. They no longer do, and that
// is the correction: with auto ON, an unknown lift is simply not one of the
// big three, and the floor applies to it like everything else. The Profile
// number is the answer to "auto is off", which section 6 covers.
check('empty selection takes the standard three, honouring the floor',
  S.restFor('') === T.standard, String(S.restFor('')))
check('a deleted custom lift does the same', S.restFor('Some Deleted Lift') === T.standard)

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
