/**
 * Logging a set with no weight on it, checked against tiles/lifting.html.
 * Plain node: `node tiles/lifting.bodyweight.test.js`.
 *
 * Until 2026-08-04 an empty weight box was refused on anything that did not
 * carry bodyweight, so a set done with just the body could not be logged at
 * all. It can now. The thing worth guarding is the line either side of that:
 * the set is REAL (it logs, it labels, it keeps its reps) and the load is NOT
 * INVENTED (a movement carrying none of the body is worth zero volume, and the
 * app says so instead of showing a silent nothing).
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

const LB_PER_KG = 2.2046226218
const sandbox = { console }
vm.createContext(sandbox)
vm.runInContext(`
  var S = { unit:'kg', bw:80, days:{} };
  var LB_PER_KG = ${LB_PER_KG};
  // Pull Up carries all of him, Push Up most of him, Leg Extension none.
  var EXDB = {
    'Pull Up':       { name:'Pull Up',       bwf:1,    uni:false },
    'Push Up':       { name:'Push Up',       bwf:0.64, uni:false },
    'Leg Extension': { name:'Leg Extension', bwf:0,    uni:false },
    'Dumbbell Row':  { name:'Dumbbell Row',  bwf:0,    uni:true  }
  };
  function findEx(n){ return EXDB[n] || null; }
  ${grab('toKg')}
  ${grab('fromKg')}
  ${grab('unitLabel')}
  ${grab('showW')}
  ${grab('setLabel')}
  ${grab('zeroWeightNote')}
  ${grab('effLoad')}
  ${grab('setVolume')}
`, sandbox)

let fails = 0
const check = (label, cond, extra) => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${cond || !extra ? '' : '  -> ' + extra}`)
  if (!cond) fails++
}
const { setLabel, zeroWeightNote, setVolume } = sandbox

console.log('\n[1] a set with no weight reads as bodyweight, not as zero')
// "0 kg x 12" is the number in the box. "bodyweight x 12" is the set he did.
check('machine work at no weight',
  setLabel({ ex:'Leg Extension', kg:0, reps:12 }, sandbox.findEx('Leg Extension')) === 'bodyweight x 12',
  setLabel({ ex:'Leg Extension', kg:0, reps:12 }, sandbox.findEx('Leg Extension')))
check('a movement that carries the body still reads the same way',
  setLabel({ ex:'Pull Up', kg:0, reps:8 }, sandbox.findEx('Pull Up')) === 'bodyweight x 8',
  setLabel({ ex:'Pull Up', kg:0, reps:8 }, sandbox.findEx('Pull Up')))
check('an exercise the library does not know',
  setLabel({ ex:'Something New', kg:0, reps:20 }, null) === 'bodyweight x 20',
  setLabel({ ex:'Something New', kg:0, reps:20 }, null))

console.log('\n[2] loaded sets are untouched by the change')
check('plain loaded set',
  setLabel({ ex:'Leg Extension', kg:60, reps:10 }, sandbox.findEx('Leg Extension')) === '60 kg x 10',
  setLabel({ ex:'Leg Extension', kg:60, reps:10 }, sandbox.findEx('Leg Extension')))
check('bodyweight PLUS added weight still says both',
  setLabel({ ex:'Pull Up', kg:20, reps:5 }, sandbox.findEx('Pull Up')) === 'bodyweight + 20 kg x 5',
  setLabel({ ex:'Pull Up', kg:20, reps:5 }, sandbox.findEx('Pull Up')))
// The unilateral rule halves stored kg back to what was typed. A zero has no
// per-hand half to show, so it must not fall into that branch and print
// "0 kg per side x 15".
check('a unilateral lift at no weight does not say "0 kg per side"',
  setLabel({ ex:'Dumbbell Row', kg:0, reps:15 }, sandbox.findEx('Dumbbell Row')) === 'bodyweight x 15',
  setLabel({ ex:'Dumbbell Row', kg:0, reps:15 }, sandbox.findEx('Dumbbell Row')))
check('a loaded unilateral lift still halves',
  setLabel({ ex:'Dumbbell Row', kg:40, reps:8 }, sandbox.findEx('Dumbbell Row')) === '20 kg per side x 8',
  setLabel({ ex:'Dumbbell Row', kg:40, reps:8 }, sandbox.findEx('Dumbbell Row')))

console.log('\n[3] THE LINE: no weight never becomes invented load')
check('a machine carrying none of him is worth 0 volume',
  setVolume({ ex:'Leg Extension', kg:0, reps:12 }) === 0,
  String(setVolume({ ex:'Leg Extension', kg:0, reps:12 })))
check('a pull up at no weight IS worth volume - it moves him',
  setVolume({ ex:'Pull Up', kg:0, reps:8 }) === 640,
  String(setVolume({ ex:'Pull Up', kg:0, reps:8 })))
check('a push up counts the fraction it actually carries, not all of him',
  Math.round(setVolume({ ex:'Push Up', kg:0, reps:10 })) === 512,
  String(setVolume({ ex:'Push Up', kg:0, reps:10 })))

console.log('\n[4] a zero that means zero is said out loud, never left silent')
const machine = zeroWeightNote({ ex:'Leg Extension', kg:0, reps:12 })
check('the note explains it adds nothing', /adds nothing/.test(machine), machine)
check('and it does not pretend otherwise', !/counts toward/.test(machine), machine)
check('a loaded set gets no note at all',
  zeroWeightNote({ ex:'Leg Extension', kg:60, reps:10 }) === '',
  zeroWeightNote({ ex:'Leg Extension', kg:60, reps:10 }))
check('a pull up with bodyweight on record needs no explanation',
  zeroWeightNote({ ex:'Pull Up', kg:0, reps:8 }) === '',
  zeroWeightNote({ ex:'Pull Up', kg:0, reps:8 }))

console.log('\n[5] no bodyweight on record: it asks, it does not guess one')
sandbox.S.bw = null
const noBw = zeroWeightNote({ ex:'Pull Up', kg:0, reps:8 })
check('says how to make it count', /bodyweight in Settings/.test(noBw), noBw)
check('and the volume stays 0 rather than a guessed body',
  setVolume({ ex:'Pull Up', kg:0, reps:8 }) === 0,
  String(setVolume({ ex:'Pull Up', kg:0, reps:8 })))
check('the label still reads honestly with no bodyweight known',
  setLabel({ ex:'Pull Up', kg:0, reps:8 }, sandbox.findEx('Pull Up')) === 'bodyweight x 8',
  setLabel({ ex:'Pull Up', kg:0, reps:8 }, sandbox.findEx('Pull Up')))
sandbox.S.bw = 80

console.log(`\n${fails} failure(s)`)
process.exit(fails ? 1 : 0)
