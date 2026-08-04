/**
 * Supersets and dropsets. Plain node: `node tiles/lifting.supersets.test.js`.
 *
 * THE CENTRAL CLAIM, and the reason this was built as a tag rather than a new
 * shape: a grouped set is still just a set. Volume, one rep max, PRs, the
 * ledger and every rank must read it identically whether or not it carries a
 * grp. [1] proves that by computing both ways over the same numbers - if
 * anything downstream ever grows a special case for grouped sets, it fails
 * here rather than quietly changing what a PR means.
 *
 * The rest is the grouping itself: runs must follow the ORDER sets were
 * logged in, and a group must never swallow a set that was not in it.
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
  function mkEx(r){
    return { name:r[0], pri:r[1], sec:r[2]?r[2].split(','):[], cat:r[3],
             pat:r[4], bwf:r[5], w:r[6], lad:r[7], uni:!!UNI_EXERCISES[r[0]], custom:false };
  }
  var LIB = RAW.map(mkEx);
  var S = { days:{}, bw:80, unit:'kg' };
  function findEx(n){ for (var i=0;i<LIB.length;i++) if (LIB[i].name===n) return LIB[i]; return null; }
  ${grab('effLoad')}
  ${grab('setVolume')}
  ${grab('groupRuns')}
  ${grab('grpLabel')}
`, sandbox)

const S = sandbox
let fails = 0
const check = (label, cond, extra) => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${cond || extra === undefined ? '' : '  -> ' + extra}`)
  if (!cond) fails++
}
const set = (id, ex, kg, reps, grp) => {
  const s = { id, ex, kg, reps, rpe: null, note: '' }
  if (grp) s.grp = grp
  return s
}
const G = (id, kind) => ({ id, kind })

// ---------------------------------------------------------------------------
console.log('\n[1] THE CENTRAL CLAIM: grouping changes no number, anywhere')
const plain = [
  set('a', 'Barbell Bench Press', 100, 5),
  set('b', 'Barbell Row', 80, 8),
  set('c', 'Barbell Bench Press', 90, 6)
]
const grouped = [
  set('a', 'Barbell Bench Press', 100, 5, G('g1', 'superset')),
  set('b', 'Barbell Row', 80, 8, G('g1', 'superset')),
  set('c', 'Barbell Bench Press', 90, 6, G('g1', 'superset'))
]
plain.forEach((p, i) => {
  check(`set ${i + 1}: same volume grouped and not`,
    S.setVolume(p) === S.setVolume(grouped[i]),
    `${S.setVolume(p)} vs ${S.setVolume(grouped[i])}`)
})
const sum = arr => arr.reduce((t, s) => t + S.setVolume(s), 0)
check('day volume is identical', sum(plain) === sum(grouped), `${sum(plain)} vs ${sum(grouped)}`)
// The heaviest set is what a PR reads. A tag must not move it.
const top = arr => arr.reduce((m, s) => (s.kg > m.kg ? s : m))
check('the heaviest set is the same set', top(plain).id === top(grouped).id)
check('effLoad ignores grp entirely',
  S.effLoad(plain[0]) === S.effLoad(grouped[0]))

console.log('\n[2] a dropset does not protect its lighter drops from the PR rule')
// This is why no special case was needed: the top set wins on its own.
const drop = [
  set('d1', 'Barbell Bench Press', 100, 5, G('g2', 'dropset')),
  set('d2', 'Barbell Bench Press', 80, 6, G('g2', 'dropset')),
  set('d3', 'Barbell Bench Press', 60, 8, G('g2', 'dropset'))
]
check('the heaviest drop is the top set', top(drop).id === 'd1')
check('a lighter drop never outranks it', top(drop).kg === 100)

// ---------------------------------------------------------------------------
console.log('\n[3] runs follow what actually happened')
let runs = S.groupRuns(grouped)
check('three sets in one group make one run', runs.length === 1, String(runs.length))
check('it holds all three', runs[0].sets.length === 3)
check('and remembers what kind it was', runs[0].grp.kind === 'superset')

runs = S.groupRuns(plain)
check('ungrouped sets are three runs of one', runs.length === 3)
check('each carries no group', runs.every(r => r.grp === null))

runs = S.groupRuns([
  set('a', 'Barbell Bench Press', 100, 5, G('g1', 'superset')),
  set('b', 'Barbell Row', 80, 8, G('g1', 'superset')),
  set('c', 'Barbell Curl', 30, 10),
  set('d', 'Leg Press', 200, 10, G('g2', 'dropset')),
  set('e', 'Leg Press', 150, 12, G('g2', 'dropset'))
])
check('a mixed day splits into the right runs', runs.length === 3, String(runs.length))
check('run 1 is the superset pair', runs[0].sets.length === 2 && runs[0].grp.kind === 'superset')
check('run 2 is the lone curl', runs[1].sets.length === 1 && runs[1].grp === null)
check('run 3 is the dropset pair', runs[2].sets.length === 2 && runs[2].grp.kind === 'dropset')
check('nothing is lost or duplicated',
  runs.reduce((n, r) => n + r.sets.length, 0) === 5)

console.log('\n[4] a group cannot swallow a set that was not in it')
// Same grp.id either side of an unrelated set. They were NOT done together,
// and drawing one block round them would say they were.
runs = S.groupRuns([
  set('a', 'Barbell Bench Press', 100, 5, G('gX', 'superset')),
  set('b', 'Barbell Curl', 30, 10),
  set('c', 'Barbell Row', 80, 8, G('gX', 'superset'))
])
check('the interrupted id makes two runs, not one', runs.length === 3, String(runs.length))
check('the middle set stays on its own', runs[1].sets[0].id === 'b' && runs[1].grp === null)
check('and every set still appears exactly once',
  runs.reduce((n, r) => n + r.sets.length, 0) === 3)

console.log('\n[5] a malformed tag degrades to ungrouped rather than breaking')
runs = S.groupRuns([
  set('a', 'Barbell Curl', 30, 10, { kind: 'superset' }),   // no id
  set('b', 'Barbell Curl', 30, 10, { kind: 'superset' })
])
check('a grp with no id is treated as no group', runs.length === 2 && runs.every(r => r.grp === null))
check('an empty day is an empty list, not a crash', S.groupRuns([]).length === 0)

console.log('\n[6] the label says what it is and how much of it')
check('superset, plural', S.grpLabel('superset', 2) === 'Superset  ·  2 sets', S.grpLabel('superset', 2))
check('dropset, plural', S.grpLabel('dropset', 3) === 'Dropset  ·  3 sets', S.grpLabel('dropset', 3))
check('singular reads right', S.grpLabel('superset', 1) === 'Superset  ·  1 set', S.grpLabel('superset', 1))
check('an unknown kind still says something true rather than undefined',
  S.grpLabel('nonsense', 2) === 'Superset  ·  2 sets')

// ---------------------------------------------------------------------------
console.log('\n[7] the wiring, read from the file')
check('logSet tags the row and does nothing else with it',
  /if \(pendingGroup\) row\.grp = \{ id: pendingGroup\.id, kind: pendingGroup\.kind \};/.test(src))
check('MID-GROUP THERE IS NO REST - that is the point of a superset',
  /if \(pendingGroup\)\{[\s\S]{0,600}?return;\s*\n\s*\}\s*\n\s*startRest\(\);/.test(src))
check('ending a group starts the rest it earned',
  /pendingGroup = null;\s*\n\s*renderHome\(\);[\s\S]{0,120}?startRest\(\);/.test(src))
check('arming also tags the set already logged, so a group is never one set',
  /last\.grp = \{ id: id, kind: kind \};/.test(src))
check('arming on an already-grouped set extends it rather than starting a second',
  /if \(last\.grp && last\.grp\.id\)\{\s*\n\s*pendingGroup = \{ id: last\.grp\.id, kind: last\.grp\.kind \};/.test(src))
check('it refuses to group when nothing has been logged yet',
  /if \(!a\.length\)\{ msg\('Log the first set/.test(src))
check('the tag on the earlier set is persisted immediately',
  /persist\(\);\s*\/\/ the tag on `last` is real now/.test(src))
check('pendingGroup is session state and is never saved into the slot',
  !/pendingGroup:/.test(src) && !/S\.pendingGroup/.test(src))
check('a dropset prefills the same lift, since only the weight changes',
  /\$\('fEx'\)\.value = last\.ex;/.test(src))
check('by body part deliberately does NOT draw groups, and says why',
  /land in DIFFERENT buckets/.test(src))

console.log(`\n${fails} failure(s)`)
process.exit(fails ? 1 : 0)
