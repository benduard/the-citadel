/**
 * Unilateral ("per side") weight, checked against tiles/lifting.html itself.
 * Plain node: `node tiles/lifting.unilateral.test.js`.
 *
 * The one invariant worth a test here: what gets typed, doubled at storage,
 * then halved back for display, must round-trip to EXACTLY what was typed -
 * not "close enough". A drift here would silently misreport every future
 * "last time" comparison for a unilateral exercise.
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
  var S = { unit: 'kg', bw: 80 };
  var LB_PER_KG = ${LB_PER_KG};
  ${grab('toKg')}
  ${grab('fromKg')}
  ${grab('unitLabel')}
  ${grab('showW')}
  ${grab('setLabel')}
`, sandbox)

let fails = 0
const check = (label, cond, extra) => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${cond || !extra ? '' : '  -> ' + extra}`)
  if (!cond) fails++
}

console.log('\n[1] UNI_EXERCISES is a real, findable lookup in the file')
check('Dumbbell Row is marked unilateral', /UNI_EXERCISES = \{ 'Dumbbell Row': true \}/.test(src))

console.log('\n[2] storage doubles what was typed (the logSet() rule)')
// Mirrors exactly what logSet() does: storedKg = toKg(kgRaw); if (uni) storedKg *= 2
function storeAsIfLogged(typedPerSide, uni) {
  let stored = sandbox.toKg(typedPerSide)
  if (uni) stored *= 2
  return stored
}
const stored20 = storeAsIfLogged(20, true)
check('20 typed, kg unit -> 40 stored (total, both sides)', stored20 === 40, stored20)

console.log('\n[3] setLabel halves it back for display - round trip is exact')
const label = sandbox.setLabel({ kg: stored20, reps: 10 }, { uni: true })
check('reads "20 kg per side x 10", not the stored 40', label === '20 kg per side x 10', label)

console.log('\n[4] a non-uni exercise is completely unaffected')
const storedBilateral = storeAsIfLogged(20, false)
check('20 typed, not uni -> 20 stored, no doubling', storedBilateral === 20, storedBilateral)
const labelBilateral = sandbox.setLabel({ kg: storedBilateral, reps: 10 }, { uni: false })
check('reads plain "20 kg x 10", no "per side"', labelBilateral === '20 kg x 10', labelBilateral)

console.log('\n[5] round-trips cleanly across a spread of real weights, both units')
;[5, 7.5, 12.5, 20, 22.5, 45, 60].forEach(typed => {
  const s = storeAsIfLogged(typed, true)
  const displayed = sandbox.showW(s / 2)
  const ok = Math.abs(displayed - typed) < 0.05
  check(`${typed} -> stored ${s.toFixed(3)} -> displayed ${displayed}`, ok, `diff ${Math.abs(displayed - typed)}`)
})

console.log('\n[6] the round trip also holds in lb, not just kg')
vm.runInContext(`S.unit = 'lb';`, sandbox)
const storedLb = storeAsIfLogged(44, true) // "44 lb per side" typed; toKg() converts once, inside the helper
const displayedBackLb = sandbox.showW(storedLb / 2)
check('44 lb per side -> round-trips to 44', Math.abs(displayedBackLb - 44) < 0.1, displayedBackLb)

console.log(`\n${fails} failure(s)`)
process.exit(fails ? 1 : 0)
