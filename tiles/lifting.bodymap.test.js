/**
 * The body map's attribution. Plain node: `node tiles/lifting.bodymap.test.js`.
 *
 * What is worth guarding here is that the chart cannot quietly lie:
 *  - a set must credit the muscle it trains AND the ones helping, at the same
 *    1.0 / 0.5 split muscleRecovery() already uses. Two panels in one tile
 *    disagreeing about what a set did would be worse than having only one.
 *  - the window must be a real window. An off-by-one at either end silently
 *    drops a session or counts one twice, and nothing on screen would show it.
 *  - every muscle in MUSCLES must be drawable, or a muscle gets trained and
 *    the figure has nowhere to shade.
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
  var BODY = ${block(/var BODY\s*=\s*\{/)};
  var UNI_EXERCISES = ${block(/var UNI_EXERCISES\s*=/)};
  function mkEx(r){
    return { name:r[0], pri:r[1], sec:r[2]?r[2].split(','):[], cat:r[3],
             pat:r[4], bwf:r[5], w:r[6], lad:r[7], uni:!!UNI_EXERCISES[r[0]], custom:false };
  }
  var LIB = RAW.map(mkEx);
  var S = { days:{}, bw:80, unit:'kg', custom:[] };
  function allEx(){ return LIB; }
  function findEx(n){ for (var i=0;i<LIB.length;i++) if (LIB[i].name===n) return LIB[i]; return null; }
  function dayKey(d){
    var m = String(d.getMonth()+1); if (m.length<2) m='0'+m;
    var day = String(d.getDate()); if (day.length<2) day='0'+day;
    return d.getFullYear()+'-'+m+'-'+day;
  }
  ${grab('today')}
  ${grab('fromKey')}
  ${grab('shift')}
  ${grab('effLoad')}
  ${grab('setVolume')}
  ${grab('windowDays')}
  ${grab('muscleWork')}
  ${grab('bodyMapData')}
`, sandbox)

const S = sandbox
let fails = 0
const check = (label, cond, extra) => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${cond || extra === undefined ? '' : '  -> ' + extra}`)
  if (!cond) fails++
}
const set = (ex, kg, reps) => ({ ex, kg, reps })
const get = (data, id) => data.rows.find(r => r.id === id)

// ---------------------------------------------------------------------------
console.log('\n[1] a set credits the primary muscle fully and helpers at half')
S.S.days = { '2026-08-01': [set('Barbell Bench Press', 100, 5)] }
let w = S.muscleWork(['2026-08-01'])
check('chest gets the full set', w.chest.sets === 1, String(w.chest.sets))
check('shoulders get half', w.delts.sets === 0.5, String(w.delts.sets))
check('triceps get half', w.triceps.sets === 0.5, String(w.triceps.sets))
check('a muscle it does not train gets nothing', w.quads.sets === 0)
check('volume splits the same way', w.delts.vol === w.chest.vol / 2,
  `${w.delts.vol} vs ${w.chest.vol}`)

console.log('\n[2] the same split muscleRecovery() uses, read straight from the file')
const recoverySplit = /targets\.push\(\[s, 0\.5\]\)/g
check('both panels push helpers at 0.5, and there are exactly two of them',
  (src.match(recoverySplit) || []).length === 2,
  String((src.match(recoverySplit) || []).length))

// ---------------------------------------------------------------------------
console.log('\n[3] the window is exactly n days, ending today')
const w7 = S.windowDays(7)
check('7 keys', w7.length === 7, String(w7.length))
check('starts today', w7[0] === '2026-08-01', w7[0])
check('ends 6 days back, not 7', w7[6] === '2026-07-26', w7[6])
check('no duplicates', new Set(w7).size === 7)

console.log('\n[4] a session just outside the window is not counted')
S.S.days = {
  '2026-08-01': [set('Back Squat', 100, 5)],
  '2026-07-26': [set('Back Squat', 100, 5)],   // 7th day back - inside
  '2026-07-25': [set('Back Squat', 100, 5)]    // 8th day back - outside
}
const d7 = S.bodyMapData(7)
check('counts the two inside the window', get(d7, 'quads').sets === 2, String(get(d7, 'quads').sets))
const d14 = S.bodyMapData(14)
check('a wider window picks up the third', get(d14, 'quads').sets === 3, String(get(d14, 'quads').sets))

console.log('\n[5] the comparison window is the SAME length, immediately before')
S.S.days = {
  '2026-08-01': [set('Back Squat', 100, 5)],                       // in window
  '2026-07-20': [set('Back Squat', 100, 5), set('Back Squat', 100, 5)] // in the 7 before
}
const cmp = S.bodyMapData(7)
check('this window sees one set', get(cmp, 'quads').sets === 1, String(get(cmp, 'quads').sets))
check('the previous window sees two', get(cmp, 'quads').prevSets === 2, String(get(cmp, 'quads').prevSets))

// ---------------------------------------------------------------------------
console.log('\n[6] nothing logged means nothing claimed')
S.S.days = {}
const empty = S.bodyMapData(7)
check('anyWork is false', empty.anyWork === false)
check('max is 0', empty.max === 0)
check('every muscle reads zero, none invented',
  empty.rows.every(r => r.sets === 0 && r.vol === 0))
check('still lists every muscle, so the figure can draw them all',
  empty.rows.length === Object.keys(S.MUSCLES).length, String(empty.rows.length))

console.log('\n[7] share is relative to the hardest hit muscle')
S.S.days = { '2026-08-01': [set('Back Squat', 100, 5), set('Back Squat', 100, 5),
                            set('Barbell Curl', 30, 10)] }
const sh = S.bodyMapData(7)
check('the top muscle has share 1', get(sh, 'quads').share === 1, String(get(sh, 'quads').share))
check('a lighter one is proportional', get(sh, 'biceps').share === 0.5,
  String(get(sh, 'biceps').share))
check('an untrained one is 0', get(sh, 'calves').share === 0)
check('rows come back sorted, hardest hit first', sh.rows[0].id === 'quads', sh.rows[0].id)

console.log('\n[8] an exercise that no longer exists cannot crash the chart')
S.S.days = { '2026-08-01': [set('Some Deleted Custom Lift', 50, 5), set('Back Squat', 100, 5)] }
const gone = S.bodyMapData(7)
check('the real set still counts', get(gone, 'quads').sets === 1)
check('the missing one is skipped, not guessed at', gone.anyWork === true)

// ---------------------------------------------------------------------------
console.log('\n[9] EVERY muscle can actually be drawn')
const drawn = Object.keys(S.BODY.muscles)
const known = Object.keys(S.MUSCLES)
const undrawable = known.filter(m => drawn.indexOf(m) === -1)
const phantom = drawn.filter(m => known.indexOf(m) === -1)
check('no muscle is trainable but undrawable', undrawable.length === 0, undrawable.join(', '))
check('the figure draws no muscle that does not exist', phantom.length === 0, phantom.join(', '))
check('every drawn muscle has at least one path',
  drawn.every(m => Array.isArray(S.BODY.muscles[m]) && S.BODY.muscles[m].length > 0))
check('every path is a real path string',
  drawn.every(m => S.BODY.muscles[m].every(p => /^M [\d.]+ [\d.]+/.test(p))))
check('the silhouette exists too', S.BODY.outline.length >= 10, String(S.BODY.outline.length))

console.log('\n[10] an empty log is an absence, not sixteen warnings')
// Caught on screen, not here: with nothing logged, every muscle took the
// amber "you skipped this" outline and the whole figure read as a warning
// about nothing. Amber is only honest once there is training to compare to.
const stroke = grab('bmStroke')
check('bmStroke takes anyWork into account at all', /anyWork/.test(stroke))
check('and returns a neutral stroke first when there is no work',
  /if\s*\(!anyWork\)\s*return\s*'rgba\(148,163,158/.test(stroke))
check('the figure passes anyWork in', /bmStroke\(r, d\.anyWork\)/.test(src))
check('the ranked list guards its amber the same way', /r\.sets <= 0 && d\.anyWork/.test(src))

console.log('\n[11] bodyweight work still counts toward the muscle')
S.S.days = { '2026-08-01': [set('Pull Up', 0, 10)] }
const bw = S.muscleWork(['2026-08-01'])
check('lats get the set', bw.lats.sets === 1)
check('and real volume, because bodyweight is load', bw.lats.vol > 0, String(bw.lats.vol))

console.log(`\n${fails} failure(s)`)
process.exit(fails ? 1 : 0)
