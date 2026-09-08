/**
 * The Screen time tile's own logic, pulled out of tiles/screentime.html.
 * Plain node: `node tiles/screentime.test.js`.
 *
 * THE ONE WORTH GUARDING ABOVE ALL OTHERS: a day has THREE possible sources
 * and they are never added together. `min` is Apple's own count arriving from
 * the Mac; `live` is what the iPhone app automations have counted so far.
 * They measure the SAME hours, not two halves of them, so summing them would
 * silently double a day - and it would look completely plausible on screen,
 * which is the worst kind of wrong. A typed day beats both.
 *
 * Second: a partial live count must never reach the ledger. It is a floor on
 * the day, not the day, and the ledger is what weights.ts turns into y and
 * what a local model reads later. Filing a floor as a fact understates every
 * day the Mac has not caught up on yet.
 */
const fs = require('fs')
const vm = require('vm')
const path = require('path')
const src = fs.readFileSync(path.join(__dirname, 'screentime.html'), 'utf8')

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

// Midday UTC so the local date is the same one almost everywhere. The expected
// key is COMPUTED from this same instant rather than written down, so the
// suite does not fail for anyone east of the dateline - the lesson
// number-check.js learned the hard way with a hardcoded date.
const NOW = new Date('2026-09-07T12:00:00.000Z')

const reported = []
const sandbox = { console, Math, JSON, isFinite, Number, String, Object, RegExp }
sandbox.Date = class extends Date {
  constructor(...a) { if (!a.length) super(NOW.getTime()); else super(...a) }
}
sandbox.window = { Vitality: { report: (s) => reported.push(s) } }
sandbox.Vitality = sandbox.window.Vitality
vm.createContext(sandbox)
vm.runInContext(`
  var state = { v:1, goalMin: 0, days: {} };
  var autoDays = {};
  var loaded = true;
  var BACKFILL = 30;
  ${grab('pad')}
  ${grab('dayKey')}
  ${grab('today')}
  ${grab('daysAgo')}
  ${grab('num')}
  ${grab('hm')}
  ${grab('typedOn')}
  ${grab('autoOn')}
  ${grab('readOn')}
  ${grab('srcWords')}
  ${grab('daysMeasured')}
  ${grab('report')}
  ${grab('reportAuto')}
`, sandbox)

let fails = 0
const check = (label, cond, extra) => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${cond || !extra ? '' : '  -> ' + extra}`)
  if (!cond) fails++
}
const { hm, readOn, num, dayKey, daysMeasured, srcWords } = sandbox
const TODAY = dayKey(NOW)
const reset = () => {
  sandbox.state.days = {}
  sandbox.state.goalMin = 0
  sandbox.autoDays = {}
  reported.length = 0
}

console.log('\n[1] hours and minutes, in the shape a person reads')
check('under an hour keeps its own shape', hm(41) === '41m', hm(41))
check('a whole hour drops the zero minutes', hm(120) === '2h', hm(120))
check('the ordinary case', hm(272) === '4h 32m', hm(272))
check('a whole day', hm(1440) === '24h', hm(1440))
// Zero is a real reading and prints as one. It is NOT the same as no reading,
// which readOn answers with null and the tile draws as an empty state.
check('zero prints as zero', hm(0) === '0m', hm(0))
check('nothing prints as nothing', hm(null) === '' && hm(undefined) === '')

console.log('\n[2] THE PRECEDENCE LAW: typed, then the Mac, then live. Never a sum.')
reset()
sandbox.autoDays[TODAY] = { min: 300, live: 120, src: 'mac-knowledgec' }
let r = readOn(TODAY)
check('the Mac count wins over the live count', r.min === 300, String(r && r.min))
check('and they are NOT added (300, not 420)', r.min !== 420, String(r && r.min))
check('the source is carried through', r.src === 'mac-knowledgec', r && r.src)
check('a full Mac count is not partial', r.partial === false)

sandbox.state.days[TODAY] = { min: 250 }
r = readOn(TODAY)
check('a typed day beats the Mac', r.min === 250, String(r && r.min))
check('and beats it without adding anything', r.min !== 550 && r.min !== 370, String(r && r.min))
check('a typed day says so', r.src === 'typed', r && r.src)

console.log('\n[3] a live-only day is a floor, and is labelled as one')
reset()
sandbox.autoDays[TODAY] = { live: 38, liveApps: { Safari: 38 }, src: 'app-automation' }
r = readOn(TODAY)
check('live is used when nothing better exists', r.min === 38, String(r && r.min))
check('and it is marked partial', r.partial === true)
check('and it says where it came from', r.src === 'live', r && r.src)
check('the words are honest about it',
  /still counting/.test(srcWords('live')), srcWords('live'))

console.log('\n[4] a day nobody measured is null, never zero')
reset()
check('an untouched day', readOn(TODAY) === null)
sandbox.autoDays[TODAY] = { src: 'mac-knowledgec' }
check('an auto row with no numbers in it', readOn(TODAY) === null)
sandbox.autoDays[TODAY] = { live: 0 }
// Zero live minutes means no session was ever paired, not a phone-free day.
check('a zero live count is nothing, not a zero day', readOn(TODAY) === null)
reset()
sandbox.state.days[TODAY] = { min: 0 }
const zero = readOn(TODAY)
// A TYPED zero is different: someone sat down and said it was zero. That is a
// measurement and it is kept.
check('a typed zero IS a reading', zero !== null && zero.min === 0, JSON.stringify(zero))

console.log('\n[5] the ledger never receives a floor')
reset()
sandbox.autoDays[TODAY] = { live: 38, src: 'app-automation' }
sandbox.report(TODAY)
check('a partial live day is not reported', reported.length === 0, JSON.stringify(reported))

sandbox.autoDays[TODAY] = { min: 272, src: 'mac-knowledgec' }
sandbox.report(TODAY)
check('a real count is reported', reported.length === 1, JSON.stringify(reported))
check('under the one agreed key', reported[0].key === 'screen_minutes', reported[0].key)
check('in MINUTES, not hours', reported[0].value === 272, String(reported[0].value))
check('dated the day it measured', reported[0].date === TODAY, reported[0].date)
check('and pointing the right way', reported[0].goalDirection === 'down', reported[0].goalDirection)

console.log('\n[6] a backfilled export reaches the ledger for every day it filled')
reset()
const d1 = dayKey(new Date(NOW.getTime() - 86400000))
const d2 = dayKey(new Date(NOW.getTime() - 2 * 86400000))
sandbox.autoDays[TODAY] = { min: 100, src: 'mac-knowledgec' }
sandbox.autoDays[d1] = { min: 200, src: 'mac-knowledgec' }
sandbox.autoDays[d2] = { live: 30, src: 'app-automation' }   // partial, must not go
sandbox.reportAuto()
check('both full days went', reported.length === 2, JSON.stringify(reported.map(r => r.date)))
check('the partial one did not', !reported.some(r => r.date === d2))

reset()
sandbox.state.days[TODAY] = { min: 250 }
sandbox.autoDays[TODAY] = { min: 100, src: 'mac-knowledgec' }
sandbox.reportAuto()
// reportAuto is for the AUTOMATION's days. A day already typed is reported by
// save() at the moment it is typed, and re-reporting it here would be a second
// write of a number nobody changed.
check('a typed day is left to save() and not re-sent', reported.length === 0,
  JSON.stringify(reported))

console.log('\n[7] the day count knows both halves')
reset()
sandbox.state.days[TODAY] = { min: 250 }
sandbox.autoDays[d1] = { min: 200 }
sandbox.autoDays[TODAY] = { min: 100 }   // same day as the typed one
check('typed and auto days are counted once each', daysMeasured() === 2, String(daysMeasured()))

console.log('\n[8] dates are local, never UTC')
// toISOString().slice(0,10) is UTC and puts an evening log on tomorrow for
// anyone east of Greenwich. Every date in this tile goes through dayKey.
check('dayKey uses local getters',
  /getFullYear\(\)[\s\S]*getMonth\(\)[\s\S]*getDate\(\)/.test(sandbox.dayKey.toString()))
check('nothing in the file reaches for toISOString to make a day key',
  !/toISOString\(\)\s*\.\s*slice/.test(src))

console.log('\n[9] the file obeys the rules that only show up on a phone')
const noComments = src.replace(/<!--[\s\S]*?-->/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ')
check('the poster number is clamped, never a fixed size',
  /\.posterHero \.num\{ font-size:clamp\(/.test(noComments),
  (noComments.match(/\.posterHero \.num\{[^}]*\}/) || [''])[0])
// min-width:0 on the flexible text is what made Lists read one letter per
// line. The floor plus flex-wrap is the fix, and it is easy to undo by
// accident while tidying CSS.
check('the app name has a real width floor',
  /\.appName\{[^}]*min-width:min\(/.test(noComments),
  (noComments.match(/\.appName\{[^}]*\}/) || [''])[0])
check('and no min-width:0 anywhere in it', !/min-width:\s*0/.test(noComments))
check('the app row can wrap instead of crushing the name',
  /\.appRow\{[^}]*flex-wrap:wrap/.test(noComments))
/**
 * tiles/sealed.test.js owns the general form of this rule and checks it across
 * every tile by walking back to each declaration's selector. This is the same
 * rule stated narrowly for the one shape that actually caused the bug: insets
 * on the UNCONDITIONAL `body` rule, which the poster inherits.
 *
 * Anchored on "\n  body{" on purpose. A loose /body\{[^}]*env\(/ also matches
 * `html[data-mode="page"] body{`, which is the correct rule, so it fails a
 * tile that got it right - which is exactly what it did when first written.
 */
check('the unconditional body rule has no safe-area inset',
  !/\n  body\{[^}]*env\(safe-area-inset/.test(noComments))
check('and page mode does take the notch, since this tile has a full page',
  /html\[data-mode="page"\] body\{[^}]*env\(safe-area-inset/.test(noComments))

console.log('\n[10] the tile declares its own store shape, as every tile must')
const header = (src.match(/<!--[\s\S]*?-->/) || [''])[0]
check('there is a header comment', header.length > 400, String(header.length))
check('it names the slot shape', /store shape via Vitality\.save\/load/.test(header))
check('it names the stream it reports', /screen_minutes/.test(header))
check('and it is honest that Apple has no API for this',
  /NO public API/.test(header) || /no public API/i.test(header))

console.log(`\n${fails} failure(s)`)
process.exit(fails ? 1 : 0)
