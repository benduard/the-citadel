const Rank = require('./rank.js')

const NOW = new Date(2026, 6, 31) // 2026-07-31 local
function iso(daysAgo) {
  const d = new Date(2026, 6, 31)
  d.setDate(d.getDate() - daysAgo)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function row(key, value, daysAgo, tile) {
  return { key, value, date: iso(daysAgo), tile: tile || key.split('_')[0] }
}

let pass = 0, fail = 0
function check(name, cond, extra) {
  if (cond) { pass++; console.log(`  PASS  ${name}`) }
  else { fail++; console.log(`  FAIL  ${name}${extra ? '  -> ' + extra : ''}`) }
}

// ── 1. empty ledger ────────────────────────────────────────────────────────
console.log('\n[1] empty ledger')
let r = Rank.compute([], NOW)
check('not ready', r.ready === false)
check('reason is empty', r.reason === 'empty', r.reason)
check('no points invented', r.points === undefined)

// ── 2. only a few days ─────────────────────────────────────────────────────
console.log('\n[2] five days of logs')
r = Rank.compute([
  row('checkin_score', 7, 0), row('checkin_score', 7, 1), row('checkin_score', 7, 2),
  row('checkin_score', 7, 3), row('checkin_score', 7, 4)
], NOW)
check('not ready', r.ready === false)
check('reason is building', r.reason === 'building', r.reason)
check('counts 5 days logged', r.daysLogged === 5, r.daysLogged)
check('23 days to go', r.daysToGo === 23, r.daysToGo)
check('no rank invented', r.tier === undefined)

// ── 3. perfectly flat, full cadence ────────────────────────────────────────
console.log('\n[3] flat but fully consistent (28d)')
let flat = []
for (let d = 0; d < 28; d++) {
  flat.push(row('checkin_score', 7, d))
  flat.push(row('sleep_hours', 8, d))
  if (d % 7 < 4) flat.push(row('lifting_volume', 5000, d))
  if (d % 7 < 3) flat.push(row('body_weight', 80, d))
}
r = Rank.compute(flat, NOW)
check('ready', r.ready === true)
const flatPts = r.points
console.log(`        points = ${flatPts}, tier = ${r.tier.name}`)
const ci = r.parts.find(p => p.id === 'checkin')
check('checkin rhythm is full', ci.rhythm === 1, ci.rhythm)
check('flat trend scores the middle, not zero', Math.abs(ci.trend - 0.5) < 0.001, ci.trend)
check('flat consistency still ranks above Bronze', flatPts >= 25, flatPts)

// ── 4. improving ───────────────────────────────────────────────────────────
console.log('\n[4] same cadence, improving numbers')
let rising = []
for (let d = 0; d < 28; d++) {
  rising.push(row('checkin_score', d < 14 ? 8.5 : 6.5, d))
  rising.push(row('sleep_hours', d < 14 ? 8.2 : 7.0, d))
  if (d % 7 < 4) rising.push(row('lifting_volume', d < 14 ? 6500 : 5000, d))
  if (d % 7 < 3) rising.push(row('body_weight', 80, d))
}
r = Rank.compute(rising, NOW)
console.log(`        points = ${r.points}, tier = ${r.tier.name}`)
check('improving beats flat', r.points > flatPts, `${r.points} vs ${flatPts}`)
const ci2 = r.parts.find(p => p.id === 'checkin')
check('rising trend scores above middle', ci2.trend > 0.5, ci2.trend)

// ── 5. declining is not punished below the floor ───────────────────────────
console.log('\n[5] same cadence, declining numbers')
let falling = []
for (let d = 0; d < 28; d++) {
  falling.push(row('checkin_score', d < 14 ? 5 : 9, d))
  falling.push(row('sleep_hours', d < 14 ? 6 : 8.5, d))
  if (d % 7 < 4) falling.push(row('lifting_volume', d < 14 ? 3000 : 6000, d))
}
r = Rank.compute(falling, NOW)
console.log(`        points = ${r.points}, tier = ${r.tier.name}`)
check('declining scores below flat', r.points < flatPts, `${r.points} vs ${flatPts}`)
check('showing up still earns something', r.points > 0, r.points)

// ── 6. THE CUMULATIVE TRAP: projects_done only ever rises ──────────────────
console.log('\n[6] cumulative counter must not read as endless improvement')
// Finished 2 projects long ago, 2 in the prior window, 2 in the recent one:
// the raw number climbs every single day, but the WORK RATE is flat.
let cum = []
for (let d = 0; d < 42; d++) {
  cum.push(row('checkin_score', 7, d))
  const done = d >= 28 ? 2 : d >= 14 ? 4 : 6
  cum.push(row('projects_done', done, d, 'projects'))
}
r = Rank.compute(cum, NOW)
const pj = r.parts.find(p => p.id === 'projects')
console.log(`        projects: recent moved ${pj.detail.recent}, prior moved ${pj.detail.prior}, trend ${pj.trend}`)
check('reads work DONE per window, not the running total', pj.detail.recent === 2 && pj.detail.prior === 2,
  JSON.stringify(pj.detail))
check('flat output = middle trend, NOT a rising one', Math.abs(pj.trend - 0.5) < 0.001, pj.trend)

// ── 7. body weight is never scored as a direction ──────────────────────────
console.log('\n[7] neutral-direction tile')
let bw = []
for (let d = 0; d < 28; d++) {
  bw.push(row('checkin_score', 7, d))
  if (d % 7 < 3) bw.push(row('body_weight', d < 14 ? 95 : 80, d)) // big gain
}
r = Rank.compute(bw, NOW)
const bd = r.parts.find(p => p.id === 'body')
check('no trend computed for body weight', bd.trend === null, String(bd.trend))
check('body still scores its rhythm', bd.rhythm === 1, bd.rhythm)

// ── 8. untouched tiles do not drag the score down ──────────────────────────
console.log('\n[8] a tile never used is excluded, not counted as failure')
let only = []
for (let d = 0; d < 28; d++) only.push(row('checkin_score', 7, d))
r = Rank.compute(only, NOW)
check('only checkin counted', r.counted === 1, r.counted)
check('score reflects the one real tile', r.points >= 50, r.points)
console.log(`        points = ${r.points}, tier = ${r.tier.name}`)

// ── 9. the ceiling is reachable but hard ───────────────────────────────────
console.log('\n[9] full cadence + sustained improvement')
let best = []
for (let d = 0; d < 42; d++) {
  best.push(row('checkin_score', d < 14 ? 9.5 : 7, d))
  best.push(row('sleep_hours', d < 14 ? 8.6 : 6.8, d))
  if (d % 7 < 4) best.push(row('lifting_volume', d < 14 ? 8000 : 5000, d))
  if (d % 7 < 3) best.push(row('body_weight', 80, d))
  const done = d >= 28 ? 1 : d >= 14 ? 3 : 8
  best.push(row('projects_done', done, d, 'projects'))
}
r = Rank.compute(best, NOW)
console.log(`        points = ${r.points}, tier = ${r.tier.name}`)
check('reaches the top of the ladder', r.tier.id === 'world-class', r.tier.id)

// ── 10. a future-dated row is not evidence ─────────────────────────────────
console.log('\n[10] rows dated in the future are ignored')
let future = flat.concat([row('checkin_score', 10, -5)])
r = Rank.compute(future, NOW)
check('future row does not change the score', r.points === flatPts, `${r.points} vs ${flatPts}`)

// ── 11. thresholds behave ──────────────────────────────────────────────────
console.log('\n[11] ladder boundaries')
check('0 -> Bronze', Rank.tierFor(0).tier.id === 'bronze')
check('29 -> Bronze', Rank.tierFor(29).tier.id === 'bronze')
check('30 -> Silver', Rank.tierFor(30).tier.id === 'silver')
check('50 -> Gold', Rank.tierFor(50).tier.id === 'gold')
check('77 -> Platinum', Rank.tierFor(77).tier.id === 'platinum')
check('78 -> Diamond', Rank.tierFor(78).tier.id === 'diamond')
check('94 -> Elite', Rank.tierFor(94).tier.id === 'elite')
check('95 -> World Class', Rank.tierFor(95).tier.id === 'world-class')
check('top tier has no next', Rank.tierFor(100).next === null)
check('weights sum to 100', Object.values(Rank.WEIGHTS).reduce((a, b) => a + b, 0) === 100)

// The three anchors the ladder is built around must stay put, or the tier
// names stop meaning what lib/rank.js says they mean.
// ── 12. a trend must not be decided by a single reading ────────────────────
console.log('\n[12] thin windows claim no trend')
// One check-in two weeks ago, one this week. A 2.5 -> 9 jump would read as a
// massive improvement if one reading counted as a baseline.
let thin = [
  { key: 'checkin_score', value: 2.5, date: iso(20), tile: 'checkin' },
  { key: 'checkin_score', value: 9.0, date: iso(2), tile: 'checkin' },
  { key: 'checkin_score', value: 7.0, date: iso(30), tile: 'checkin' }
]
r = Rank.compute(thin, NOW)
let tc = r.parts.find(p => p.id === 'checkin')
check('no trend claimed from one reading a side', tc.trend === null, String(tc.trend))
check('flagged as thin, not as missing', tc.detail.thin === true)
check('the real numbers are still kept', tc.detail.recent === 9 && tc.detail.prior === 2.5,
  JSON.stringify(tc.detail))
check('still scored on showing up', tc.score !== null && tc.score === tc.rhythm, `${tc.score} / ${tc.rhythm}`)

// Three a side clears the bar.
let enough = []
for (let d = 0; d < 28; d++) if (d % 4 === 0) enough.push({ key: 'checkin_score', value: d < 14 ? 9 : 7, date: iso(d), tile: 'checkin' })
r = Rank.compute(enough, NOW)
tc = r.parts.find(p => p.id === 'checkin')
check('enough readings -> a trend is computed', tc.trend !== null, String(tc.trend))
check('and it reads as improving', tc.trend > 0.5, String(tc.trend))

// Lifting totals need only two a side: a total of two sessions is a real total.
let lift = [
  { key: 'lifting_volume', value: 5000, date: iso(2), tile: 'lifting' },
  { key: 'lifting_volume', value: 5200, date: iso(5), tile: 'lifting' },
  { key: 'lifting_volume', value: 4000, date: iso(16), tile: 'lifting' },
  { key: 'lifting_volume', value: 4100, date: iso(19), tile: 'lifting' }
]
r = Rank.compute(lift, NOW)
const tl = r.parts.find(p => p.id === 'lifting')
check('two sessions a side is enough for a volume total', tl.trend !== null, String(tl.trend))

console.log('\n[13] the ladder anchors hold')
check('perfect cadence + flat  -> Platinum', Rank.tierFor(75).tier.id === 'platinum')
check('perfect cadence + declining -> Gold', Rank.tierFor(50).tier.id === 'gold')
check('Diamond is unreachable on consistency alone', 75 < 78)

console.log(`\n${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)
