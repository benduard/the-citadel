/**
 * Pull the real functions out of tiles/lifting.html and exercise the
 * "last time, set by set" logic against a fake log. No browser, no guessing.
 */
const fs = require('fs')
const vm = require('vm')
const src = fs.readFileSync(require('path').join(__dirname, 'lifting.html'), 'utf8')

function grab(name, kind = 'function') {
  const re = new RegExp(`\\n  ${kind} ${name}\\(`)
  const at = src.search(re)
  if (at === -1) throw new Error('could not find ' + name)
  // walk braces from the first { after the signature
  let i = src.indexOf('{', at), depth = 0, end = i
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') { depth--; if (!depth) { end = i + 1; break } }
  }
  return src.slice(src.search(re) + 1, end)
}

const parts = ['prevSessionFor', 'todaySetsFor', 'compareSet', 'lastTimeWhen', 'fromKey', 'niceDate', 'setLabel',
               'effLoad', 'setVolume', 'e1rm', 'esc', 'showW', 'fromKg', 'unitLabel']
  .map(n => grab(n)).join('\n')

const sandbox = { console }
vm.createContext(sandbox)

const S = { unit: 'lb', bw: 80, days: {} }
const LB_PER_KG = 2.2046226218
const harness = `
  var S = ${JSON.stringify(S)};
  var LB_PER_KG = ${LB_PER_KG};
  var TODAY = '2026-07-31';
  function today(){ return TODAY; }
  function findEx(n){ return EXDB[n] || null; }
  var EXDB = { 'Bench Press': { bwf:0 }, 'Pull Up': { bwf:1 } };
  ${parts}
`
vm.runInContext(harness, sandbox)

let fails = 0
const check = (label, cond, extra) => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${cond || !extra ? '' : '  -> ' + extra}`)
  if (!cond) fails++
}
const lb = v => v / LB_PER_KG // helper: store kg, think in lb

// ── the scenario from the ask: 100lb x 10 on set 1 last week ───────────────
sandbox.S.days = {
  '2026-07-24': [
    { id: 'a', ex: 'Bench Press', kg: lb(100), reps: 10 },
    { id: 'b', ex: 'Bench Press', kg: lb(95),  reps: 8 },
    { id: 'c', ex: 'Bench Press', kg: lb(95),  reps: 6 },
    { id: 'd', ex: 'Pull Up',     kg: 0,       reps: 12 }
  ],
  '2026-07-28': [
    { id: 'e', ex: 'Pull Up', kg: 0, reps: 14 }
  ]
}

console.log('\n[1] finds the last session containing THAT exercise')
let p = sandbox.prevSessionFor('Bench Press')
check('found a session', !!p)
check('picked 2026-07-24', p.date === '2026-07-24', p.date)
check('only that exercise, 3 sets', p.sets.length === 3, p.sets.length)
check('set order preserved', p.sets.map(s => s.reps).join(',') === '10,8,6', p.sets.map(s => s.reps).join(','))

console.log('\n[2] a different exercise gets its own, more recent session')
p = sandbox.prevSessionFor('Pull Up')
check('picked 2026-07-28, not the bench day', p.date === '2026-07-28', p.date)
check('one set', p.sets.length === 1)

console.log('\n[3] labels read in the display unit (lb)')
p = sandbox.prevSessionFor('Bench Press')
const l1 = sandbox.setLabel(p.sets[0], { bwf: 0 })
check('set 1 shows 100 lb x 10', l1 === '100 lb x 10', l1)

console.log('\n[4] which set am I on right now')
check('nothing logged today -> next is set 1 (index 0)', sandbox.todaySetsFor('Bench Press').length === 0)
sandbox.S.days['2026-07-31'] = [{ id: 'x', ex: 'Bench Press', kg: lb(105), reps: 10 }]
check('after one set -> next is set 2 (index 1)', sandbox.todaySetsFor('Bench Press').length === 1)

console.log('\n[5] set-for-set comparison, by estimated 1RM not weight alone')
let now = { ex: 'Bench Press', kg: lb(105), reps: 10 }
let then = { ex: 'Bench Press', kg: lb(100), reps: 10 }
let c = sandbox.compareSet(now, then)
check('heavier same reps -> up', c.cls === 'up', JSON.stringify(c))
check('reports 5%', c.text === 'up 5%', c.text)

c = sandbox.compareSet({ ex:'Bench Press', kg: lb(100), reps: 12 }, { ex:'Bench Press', kg: lb(100), reps: 10 })
check('same weight MORE reps -> up (weight alone would say flat)', c.cls === 'up', JSON.stringify(c))

c = sandbox.compareSet({ ex:'Bench Press', kg: lb(100), reps: 10 }, { ex:'Bench Press', kg: lb(100), reps: 10 })
check('identical -> matched', c.cls === 'same', JSON.stringify(c))

c = sandbox.compareSet({ ex:'Bench Press', kg: lb(90), reps: 10 }, { ex:'Bench Press', kg: lb(100), reps: 10 })
check('lighter -> down, never an error', c.cls === 'down', JSON.stringify(c))

console.log('\n[5b] THE BUG RUBEN REPORTED: heavier for fewer reps is progress')
// Volume (the old basis) called this "down 12%" because total tonnage fell.
// He added 10kg to the bar. That is not a loss and the panel may not say so.
c = sandbox.compareSet({ ex:'Bench Press', kg: 110, reps: 8 }, { ex:'Bench Press', kg: 100, reps: 10 })
check('110x8 after 100x10 reads UP, not down', c.cls === 'up', JSON.stringify(c))
check('and by a believable 5%, not 25%', c.text === 'up 5%', c.text)
check('it says the basis was strength', c.basis === 'strength', c.basis)

// The mirror of it: two extra reps at the same weight used to inflate to 25%.
c = sandbox.compareSet({ ex:'Bench Press', kg: 100, reps: 10 }, { ex:'Bench Press', kg: 100, reps: 8 })
check('two extra reps is up 5%, not up 25%', c.text === 'up 5%', c.text)

// Dropping weight to chase reps is NOT progress, and must not read as up.
c = sandbox.compareSet({ ex:'Bench Press', kg: 80, reps: 12 }, { ex:'Bench Press', kg: 100, reps: 10 })
check('80x12 after 100x10 reads down', c.cls === 'down', JSON.stringify(c))

console.log('\n[5c] past 12 reps Epley says nothing, so it falls back and admits it')
c = sandbox.compareSet({ ex:'Bench Press', kg: 40, reps: 15 }, { ex:'Bench Press', kg: 40, reps: 20 })
check('a 15-rep machine set still compares', !!c, JSON.stringify(c))
check('on the volume basis', c.basis === 'volume', c.basis)
check('fewer reps at the same weight -> down', c.cls === 'down', JSON.stringify(c))

console.log('\n[6] bodyweight movements count the body')
c = sandbox.compareSet({ ex:'Pull Up', kg: 0, reps: 14 }, { ex:'Pull Up', kg: 0, reps: 12 })
check('more pull ups -> up even at 0 on the bar', c && c.cls === 'up', JSON.stringify(c))

console.log('\n[6b] a movement carrying no bodyweight, nothing on the bar, still compares')
// Volume is zero on both sides here, so the old code returned null and the
// row simply showed no comparison at all. Reps are the only thing that
// changed, so reps are what it counts - and it says that is what it did.
c = sandbox.compareSet({ ex:'Bench Press', kg: 0, reps: 20 }, { ex:'Bench Press', kg: 0, reps: 15 })
check('more reps at no load -> up', c && c.cls === 'up', JSON.stringify(c))
check('on the reps basis', c && c.basis === 'reps', c && c.basis)

console.log('\n[6c] load arriving where there was none is not a percentage')
c = sandbox.compareSet({ ex:'Bench Press', kg: 20, reps: 10 }, { ex:'Bench Press', kg: 0, reps: 10 })
check('says what happened instead of dividing by zero', c && c.cls === 'up', JSON.stringify(c))
check('no Infinity, no NaN in the text', c && !/Infinity|NaN/.test(c.text), c && c.text)

console.log('\n[7] never trained before')
check('unknown exercise -> null, not a crash', sandbox.prevSessionFor('Zercher Squat') === null)
check('empty name -> null', sandbox.prevSessionFor('') === null)

console.log('\n[8] today is never its own "last time"')
sandbox.S.days = { '2026-07-31': [{ id:'z', ex:'Bench Press', kg: lb(100), reps: 5 }] }
check('only today logged -> no previous session', sandbox.prevSessionFor('Bench Press') === null)

console.log('\n[9] a future-dated day is not "last time"')
sandbox.S.days = {
  '2026-08-05': [{ id:'f', ex:'Bench Press', kg: lb(999), reps: 1 }],
  '2026-07-20': [{ id:'g', ex:'Bench Press', kg: lb(100), reps: 5 }]
}
p = sandbox.prevSessionFor('Bench Press')
check('picks the past day, ignores the future one', p.date === '2026-07-20', p.date)

console.log('\n[10] date wording')
sandbox.S.days = { '2026-07-30': [{ id:'h', ex:'Bench Press', kg: 50, reps: 5 }] }
check('1 day ago reads "yesterday"', sandbox.lastTimeWhen('2026-07-30') === 'yesterday', sandbox.lastTimeWhen('2026-07-30'))
check('7 days ago says how long', /7 days ago/.test(sandbox.lastTimeWhen('2026-07-24')), sandbox.lastTimeWhen('2026-07-24'))
check('far back is just the date', !/ago/.test(sandbox.lastTimeWhen('2026-01-02')), sandbox.lastTimeWhen('2026-01-02'))

console.log('\n[11] RPE survives the lookup, so the panel can show it')
// The panel reminds him what that exact set WAS, and how hard it felt is part
// of that: 100kg at RPE 6 and 100kg at RPE 9 print the same numbers and are
// different sessions. This guards the carry-through - reshaping prevSessionFor
// to hand back only { kg, reps } would empty the RPE column with no error.
sandbox.S.days = {
  '2026-07-24': [
    { id:'r1', ex:'Bench Press', kg: lb(100), reps: 10, rpe: 8 },
    { id:'r2', ex:'Bench Press', kg: lb(100), reps: 8 }          // logged before he rated them
  ]
}
p = sandbox.prevSessionFor('Bench Press')
check('a rated set keeps its RPE', p.sets[0].rpe === 8, String(p.sets[0].rpe))
check('an unrated set stays unrated, not zero', !isFinite(p.sets[1].rpe), String(p.sets[1].rpe))

console.log('\n[12] a hand-typed exercise name cannot inject markup')
const bad = sandbox.esc('<img src=x onerror="alert(1)">')
check('escaped', !bad.includes('<') && bad.includes('&lt;'), bad)

console.log(`\n${fails} failure(s)`)
process.exit(fails ? 1 : 0)
