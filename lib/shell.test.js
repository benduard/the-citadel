// Pull the rank render block straight out of index.html and run it against
// real lib/rank.js output, with a stub DOM. Catches typos and undefined
// helpers that only ever show up in a browser console.
const fs = require('fs')
const path = require('path').join(__dirname,'..','index.html')
const html = fs.readFileSync(path, 'utf8')

const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1])
const block = blocks.find(b => b.includes('function renderRank'))
if (!block) { console.error('FAIL: could not find the rank script block'); process.exit(1) }

const Rank = require('./rank.js')

const elements = {}
function el(id) {
  if (!elements[id]) elements[id] = { id, innerHTML: '', textContent: '', className: '', style: { setProperty(){} } }
  return elements[id]
}

let ledgerRows = []
let ledgerReads = 0
const listeners = {}
const sandbox = {
  document: { getElementById: el, addEventListener(){}, readyState: 'complete' },
  window: {
    addEventListener(name, fn) { (listeners[name] = listeners[name] || []).push(fn) },
    VitalityRank: Rank,
    VitalityHost: { ledger: () => { ledgerReads++; return Promise.resolve(ledgerRows) } },
    TILES: [
      { id: 'checkin', name: 'Check in' }, { id: 'lifting', name: 'Lifting' },
      { id: 'recovery', name: 'Recovery' }, { id: 'body', name: 'Body' },
      { id: 'projects', name: 'Projects' }
    ],
    VitalityRemote: null
  },
  console
}
sandbox.window.document = sandbox.document

const vm = require('vm')
vm.createContext(sandbox)
try {
  vm.runInContext(block, sandbox)
} catch (e) {
  console.error('FAIL: script threw on load ->', e.message)
  process.exit(1)
}

function iso(daysAgo) {
  const d = new Date(); d.setDate(d.getDate() - daysAgo)
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}

let fails = 0
function scenario(name, rows, expectations) {
  ledgerRows = rows
  elements.rank && (elements.rank.innerHTML = '')
  return Promise.resolve(sandbox.refreshBoard()).then(() => new Promise(r => setImmediate(r))).then(() => {
    const out = el('rank').innerHTML
    console.log(`\n--- ${name} ---`)
    if (!out) { console.log('  FAIL  rendered nothing'); fails++; return }
    expectations.forEach(([label, test]) => {
      const ok = typeof test === 'string' ? out.includes(test) : test(out)
      console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`)
      if (!ok) fails++
    })
    if (out.includes('undefined') || out.includes('NaN') || out.includes('[object')) {
      console.log('  FAIL  output contains undefined/NaN/[object'); fails++
    } else console.log('  PASS  no undefined / NaN leaked into the markup')
  })
}

const full = []
for (let d = 0; d < 30; d++) {
  full.push({ key: 'checkin_score', value: d < 14 ? 8.4 : 7.0, date: iso(d), tile: 'checkin' })
  full.push({ key: 'sleep_hours', value: d < 14 ? 7.9 : 7.6, date: iso(d), tile: 'recovery' })
  if (d % 7 < 4) full.push({ key: 'lifting_volume', value: d < 14 ? 6200 : 5800, date: iso(d), tile: 'lifting' })
  if (d % 7 < 3) full.push({ key: 'body_weight', value: 81.2, date: iso(d), tile: 'body' })
}

scenario('empty ledger', [], [
  ['says there is no standing yet', 'No standing yet'],
  ['does not invent a tier', o => !/Bronze|Silver|Gold|Platinum|Diamond/.test(o.split('tierchip')[0])],
  ['still prints the scale', 'How this is worked out']
])
.then(() => scenario('6 days in', [
  { key: 'checkin_score', value: 7, date: iso(0), tile: 'checkin' },
  { key: 'checkin_score', value: 7, date: iso(5), tile: 'checkin' }
], [
  ['counts down instead of ranking', 'more days'],
  ['explains why', 'needs 28 days of history'],
  ['shows attribute rows while building', 'attr-name']
]))
.then(() => scenario('30 days, improving', full, [
  ['renders a tier name', o => /rank-name">(Bronze|Silver|Gold|Platinum|Diamond|Elite|World Class)</.test(o)],
  ['shows rank points', 'RANK POINTS'],
  ['shows an improving arrow', '↑'],
  ['shows the real numbers behind the trend', o => o.includes(' v ')],
  ['body reads as no direction', 'no direction set'],
  ['projects never started', 'not started'],
  ['marks current tier in the ladder', 'tierchip here']
]))
.then(() => {
  // ── both panels, one read ───────────────────────────────────────────────
  console.log('\n--- one ledger read feeds every panel ---')
  ledgerReads = 0
  return Promise.resolve(sandbox.refreshBoard())
    .then(() => new Promise(r => setImmediate(r)))
    .then(() => {
      const ok = ledgerReads === 1
      console.log(`  ${ok ? 'PASS' : 'FAIL'}  refreshBoard reads the ledger once, not once per panel (${ledgerReads})`)
      if (!ok) fails++
      const cov = el('coverage').innerHTML
      const covOk = cov.includes('goalcard')
      console.log(`  ${covOk ? 'PASS' : 'FAIL'}  coverage rendered from the same read`)
      if (!covOk) fails++
    })
})
.then(() => {
  // ── the staleness fix ───────────────────────────────────────────────────
  console.log('\n--- a landed report refreshes the board ---')
  const wired = (listeners['vitality:ledger'] || []).length === 1
  console.log(`  ${wired ? 'PASS' : 'FAIL'}  shell listens for vitality:ledger`)
  if (!wired) fails++
  ledgerReads = 0
  return Promise.resolve(listeners['vitality:ledger'][0]())
    .then(() => new Promise(r => setImmediate(r)))
    .then(() => {
      const ok = ledgerReads === 1
      console.log(`  ${ok ? 'PASS' : 'FAIL'}  firing it re-reads the ledger (${ledgerReads})`)
      if (!ok) fails++
    })
})
.then(() => {
  // ── host.js must actually fire that event ───────────────────────────────
  console.log('\n--- host.js fires it, and only on a write that landed ---')
  const host = fs.readFileSync(require('path').join(__dirname,'tiles','host.js'), 'utf8')
  const fires = /dispatchEvent\(new CustomEvent\('vitality:ledger'/.test(host)
  console.log(`  ${fires ? 'PASS' : 'FAIL'}  host dispatches vitality:ledger`)
  if (!fires) fails++
  const guarded = /if \(landed\) \{[\s\S]{0,200}vitality:ledger/.test(host)
  console.log(`  ${guarded ? 'PASS' : 'FAIL'}  guarded by "landed", so a failed report never claims success`)
  if (!guarded) fails++

  // ── the close button, on a phone with a notch ───────────────────────────
  // Reported from a real iPhone: the button sat under the status bar and was
  // too small to hit. Neither half of that is visible to any check we can run
  // - headless Chromium has no notch, so env() is 0 and the button measures
  // fine. So the SOURCE is pinned instead. If someone reverts either half,
  // this fails here rather than on his phone a week later.
  console.log('\n--- the page close button clears the notch and is tappable ---')
  // [\s\S] not [^'] - the rule is built by concatenating quoted chunks, so the
  // selector and its padding live in two different string literals.
  const overlayInset = /\.vPage\{[\s\S]{0,200}?padding:env\(safe-area-inset-top/.test(host)
  console.log(`  ${overlayInset ? 'PASS' : 'FAIL'}  the overlay itself is inset, so the FRAME starts below the status bar`)
  if (!overlayInset) fails++

  const btnInset = /\.vPageClose\{[\s\S]{0,200}top:calc\(env\(safe-area-inset-top/.test(host)
  console.log(`  ${btnInset ? 'PASS' : 'FAIL'}  and the button carries the same inset`)
  if (!btnInset) fails++

  const size = (host.match(/\.vPageClose\{[\s\S]{0,400}?width:(\d+)px;height:(\d+)px/) || [])
  const w = Number(size[1]), h = Number(size[2])
  const bigEnough = w >= 44 && h >= 44
  console.log(`  ${bigEnough ? 'PASS' : 'FAIL'}  at least a 44px touch target (is ${w}x${h})`)
  if (!bigEnough) fails++
})
.then(() => {
  const r = Rank.compute(full)
  console.log(`\nComputed: ${r.points}/100 -> ${r.tier.name}  (counted ${r.counted} tiles)`)
  console.log(`\n${fails} failure(s)`)
  process.exit(fails ? 1 : 0)
})
