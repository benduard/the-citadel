/**
 * Max attempts, and the per-side switch. Plain node:
 * `node tiles/lifting.max.test.js`.
 *
 * The two lines worth guarding, and they are the same line twice:
 *
 *  - A MISS MOVES NOTHING. Nothing was lifted, so it must not reach a max, a
 *    PR, a rank or a kilogram of volume. A log that lets a failed attempt
 *    count is a log that lies about what you can do.
 *  - FLIPPING THE PER-SIDE SWITCH REWRITES NOTHING. Stored kg is the total on
 *    the body, always. The switch changes how the box is READ and how the
 *    number is LABELLED - never what a set already means, or every rank and
 *    every PR would silently double or halve.
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

const TODAY = '2026-08-04'
const sandbox = { console }
vm.createContext(sandbox)
vm.runInContext(`
  var LB_PER_KG = 2.2046226218;
  var S = { unit:'kg', bw:100, days:{}, attempts:[], uni:{} };
  var UNI_EXERCISES = { 'Dumbbell Row': true };
  function today(){ return '${TODAY}'; }
  var EXDB = {
    'Back Squat':   { name:'Back Squat',   bwf:0, uni:false, lad:null },
    'Dumbbell Row': { name:'Dumbbell Row', bwf:0, uni:true,  lad:null },
    'Pull Up':      { name:'Pull Up',      bwf:1, uni:false, lad:null }
  };
  function findEx(n){ return EXDB[n] || null; }
  function history(){
    var out = [];
    Object.keys(S.days).sort().forEach(function(d){
      (S.days[d] || []).forEach(function(s){ out.push({ d:d, s:s }); });
    });
    return out;
  }
  ${grab('isUni')}
  ${grab('maxOf')}
  ${grab('attemptsFor')}
  ${grab('unclearedFor')}
  ${grab('effLoad')}
  ${grab('setVolume')}
`, sandbox)

let fails = 0
const check = (label, cond, extra) => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${cond || !extra ? '' : '  -> ' + extra}`)
  if (!cond) fails++
}
const S = sandbox.S
const { maxOf, unclearedFor, isUni, setVolume } = sandbox

console.log('\n[1] the max is the heaviest single actually lifted')
S.days = {
  '2026-07-01': [{ id:'a', ex:'Back Squat', kg:140, reps:1 }],
  '2026-07-15': [{ id:'b', ex:'Back Squat', kg:150, reps:1 }],
  '2026-07-20': [{ id:'c', ex:'Back Squat', kg:145, reps:1 }]
}
check('picks the heaviest, not the latest', maxOf('Back Squat').kg === 150, String(maxOf('Back Squat').kg))
check('and carries the day it happened', maxOf('Back Squat').date === '2026-07-15', maxOf('Back Squat').date)
check('an exercise with no singles has no max', maxOf('Pull Up') === null)

console.log('\n[2] only SINGLES count as a max')
// A heavy triple is a great set and it is not a max. e1RM already exists for
// the estimate, and it is labelled an estimate wherever it is shown.
S.days = { '2026-07-01': [{ id:'a', ex:'Back Squat', kg:200, reps:3 }] }
check('a triple at 200 is not a 200 max', maxOf('Back Squat') === null,
  JSON.stringify(maxOf('Back Squat')))
S.days['2026-07-02'] = [{ id:'b', ex:'Back Squat', kg:150, reps:1 }]
check('the single is, even though it is lighter', maxOf('Back Squat').kg === 150,
  String(maxOf('Back Squat').kg))
// A bodyweight-only single has no bar weight to be a max of.
S.days = { '2026-07-01': [{ id:'a', ex:'Pull Up', kg:0, reps:1 }] }
check('a single with nothing on the bar is not a max', maxOf('Pull Up') === null)

console.log('\n[3] THE LINE: a miss moves nothing at all')
S.days = { '2026-07-01': [{ id:'a', ex:'Back Squat', kg:150, reps:1 }] }
S.attempts = [
  { id:'m1', date:'2026-07-05', ex:'Back Squat', kg:170, hit:false },
  { id:'m2', date:'2026-07-12', ex:'Back Squat', kg:170, hit:false }
]
check('two misses at 170 do not raise the max off 150', maxOf('Back Squat').kg === 150,
  String(maxOf('Back Squat').kg))
// The strongest form of this: maxOf must not even LOOK at attempts. If it
// read them, a miss could become a max through one careless edit.
check('maxOf never reads S.attempts', !/S\.attempts/.test(grab('maxOf')), grab('maxOf'))
// And a miss writes no set, so there is nothing for volume to find.
check('a miss leaves the day it happened on empty of sets',
  !(S.days['2026-07-05'] || []).length)

console.log('\n[4] what is still to get')
let open = unclearedFor('Back Squat')
check('170 is listed as uncleared', open.length === 1 && open[0].kg === 170, JSON.stringify(open))
check('and it counts the tries', open[0].n === 2, String(open[0].n))
// Once it is hit, an old miss at that weight is history, not a target.
S.days['2026-07-20'] = [{ id:'b', ex:'Back Squat', kg:170, reps:1 }]
check('hitting it clears it from the list', unclearedFor('Back Squat').length === 0,
  JSON.stringify(unclearedFor('Back Squat')))
check('and the max moves to it', maxOf('Back Squat').kg === 170, String(maxOf('Back Squat').kg))
// A miss BELOW the current max is not an open target either - it is a bad day
// at a weight already owned.
S.attempts.push({ id:'m3', date:'2026-07-25', ex:'Back Squat', kg:160, hit:false })
check('a miss under the current max is not chased', unclearedFor('Back Squat').length === 0,
  JSON.stringify(unclearedFor('Back Squat')))

console.log('\n[5] a hit is a real set, which is what makes the max move')
/**
 * The design decision worth pinning. A hit goes through the ordinary set path
 * rather than a special "max" store, because one rep at that weight IS a set
 * actually performed - so PRs, volume, e1RM, ranks, XP and the ledger all pick
 * it up with no branch written for maxes to get wrong.
 */
const logAttempt = grab('logAttempt')
check('a hit pushes a real row into S.days', /S\.days\[k\]\.push\(row\)/.test(logAttempt))
check('at exactly one rep', /reps:1/.test(logAttempt))
check('and links the two so they can be seen to be one event', /a\.setId = row\.id/.test(logAttempt))
check('a miss pushes no set', /if \(hit\)\{[\s\S]*?a\.setId = row\.id;\s*\}/.test(logAttempt))
check('the attempt itself is always recorded, hit or miss',
  /S\.attempts\.push\(a\)/.test(logAttempt))
// It must never claim a new max that did not happen.
check('the "new max" line only fires when it really is heavier',
  /prev && kg > prev\.kg/.test(logAttempt))

console.log('\n[6] the per-side switch is his call, and it overrides the file')
S.uni = {}
check('the built-in default stands when nothing is set',
  isUni('Dumbbell Row', sandbox.UNI_EXERCISES['Dumbbell Row']) === true)
check('and a lift with no default is not per side',
  isUni('Back Squat', sandbox.UNI_EXERCISES['Back Squat']) === false)
S.uni['Back Squat'] = true
check('switching one on overrides the file', isUni('Back Squat', undefined) === true)
S.uni['Dumbbell Row'] = false
check('switching one OFF overrides the file too - not just on',
  isUni('Dumbbell Row', true) === false)
// false is a real answer and must survive. A truthy check here would let an
// explicit "no" fall back to the file's "yes".
check('an explicit false is not treated as unset',
  Object.prototype.hasOwnProperty.call(S.uni, 'Dumbbell Row') && isUni('Dumbbell Row', true) === false)

console.log('\n[7] THE LINE: flipping it rewrites nothing')
/**
 * Stored kg is the total on the body, always. Flipping the switch changes how
 * the input box is read and how the label prints. If it ever changed what a
 * stored set MEANS, every rank and every PR in the history would silently
 * double or halve, and nothing on screen would say so.
 */
S.uni = {}
S.days = { '2026-07-01': [{ id:'a', ex:'Dumbbell Row', kg:40, reps:8 }] }
const volBefore = setVolume(S.days['2026-07-01'][0])
S.uni['Dumbbell Row'] = false
const volAfter = setVolume(S.days['2026-07-01'][0])
check('volume is identical either side of the switch', volBefore === volAfter,
  volBefore + ' vs ' + volAfter)
check('and it is the stored total, not half of it', volAfter === 320, String(volAfter))
S.days = { '2026-07-01': [{ id:'a', ex:'Dumbbell Row', kg:60, reps:1 }] }
const maxBefore = maxOf('Dumbbell Row').kg
S.uni['Dumbbell Row'] = true
check('the max is the same number after flipping', maxOf('Dumbbell Row').kg === maxBefore,
  maxOf('Dumbbell Row').kg + ' vs ' + maxBefore)
// The one thing that DOES change is the input, and a half typed weight would
// otherwise silently log as double. Same reasoning as the kg/lb toggle.
check('the switch clears the weight boxes rather than reinterpreting them',
  /S\.uni\[un\] = !eu\.uni;[\s\S]{0,400}\$\('fKg'\)\.value = '';/.test(src))
check('and it rebuilds LIB, which baked the old value in at load',
  /S\.uni\[un\] = !eu\.uni;\s*\n\s*rebuildLib\(\);/.test(src))

console.log('\n[8] the per-hand doubling still happens on the way in')
// What is typed is one hand; what is stored is both. logAttempt follows the
// same rule every set follows, or a max single would be stored at half.
check('logAttempt doubles a per-side weight before storing',
  /if \(e && e\.uni\) kg \*= 2;/.test(logAttempt))

console.log(`\n${fails} failure(s)`)
process.exit(fails ? 1 : 0)
