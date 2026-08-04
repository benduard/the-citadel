/**
 * The day view - times on items, and the hours they land in.
 * Plain node: `node tiles/lists.day.test.js`.
 *
 * What is worth guarding: a time exists ONLY because someone typed it. The
 * whole point of laying a day out in hours is to show the schedule that was
 * actually written, so the failure that matters here is not a crash, it is an
 * item quietly appearing at an hour nobody chose.
 */
const fs = require('fs')
const vm = require('vm')
const path = require('path')
const src = fs.readFileSync(path.join(__dirname, 'lists.html'), 'utf8')

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

const sandbox = { console }
vm.createContext(sandbox)
vm.runInContext(`
  ${grab('validAt')}
  ${grab('hourOf')}
  ${grab('prettyHour')}
`, sandbox)

let fails = 0
const check = (label, cond, extra) => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${cond || !extra ? '' : '  -> ' + extra}`)
  if (!cond) fails++
}
const { validAt, hourOf, prettyHour } = sandbox

console.log('\n[1] a time is only a time if it really is one')
check('07:30', validAt('07:30') === '07:30', validAt('07:30'))
check('a single-digit hour is padded, so string sorting works',
  validAt('7:30') === '07:30', validAt('7:30'))
check('midnight', validAt('00:00') === '00:00', validAt('00:00'))
check('the last minute of the day', validAt('23:59') === '23:59', validAt('23:59'))
check('surrounding space is forgiven', validAt('  9:05 ') === '09:05', validAt('  9:05 '))

console.log('\n[2] and anything else is no time at all, never a guess')
;['', null, undefined, '25:00', '12:60', 'noon', '7', '730', '07:3', '-1:00', '1:00pm']
  .forEach(v => check(`${JSON.stringify(v)} -> no time`, validAt(v) === '', validAt(v)))

console.log('\n[3] the hour an item lands in')
check('07:30 is the 7am block', hourOf('07:30') === 7, String(hourOf('07:30')))
check('00:10 is the midnight block', hourOf('00:10') === 0, String(hourOf('00:10')))
check('23:59 is the 11pm block', hourOf('23:59') === 23, String(hourOf('23:59')))
// -1 is what keeps an untimed item OUT of the clock and in "Any time". If this
// ever returned 0, every item without a time would silently pile into midnight.
check('no time -> -1, which is what keeps it out of the hours',
  hourOf('') === -1 && hourOf(undefined) === -1 && hourOf('half nine') === -1)

console.log('\n[4] hours read the way a person says them')
check('0 is 12am', prettyHour(0) === '12am', prettyHour(0))
check('9 is 9am', prettyHour(9) === '9am', prettyHour(9))
check('12 is 12pm, not 0pm', prettyHour(12) === '12pm', prettyHour(12))
check('13 is 1pm', prettyHour(13) === '1pm', prettyHour(13))
check('23 is 11pm', prettyHour(23) === '11pm', prettyHour(23))

console.log('\n[5] the rules the view is built on, read off the file')
// Untimed items go in their own band. Scattering them into plausible hours
// would be showing a schedule nobody wrote, which is the one thing this view
// must not do.
check('untimed items get an "Any time" band, not an invented hour',
  /secLabelEl\('Any time'\)/.test(src))
check('the band is chosen by hourOf, so it cannot drift from the parser',
  /var loose = rows\.filter\(function\(r\)\{ return hourOf\(r\.e\.at\) < 0; \}\)/.test(src))
// The gaps in a day are information. A view that closes them up is a list.
check('empty hours between the first and last are kept',
  /for \(var h = from; h <= to; h\+\+\)/.test(src))
check('the range comes from the items themselves, not a fixed 9-to-5',
  /Math\.min\.apply\(null, hours\)/.test(src) && /Math\.max\.apply\(null, hours\)/.test(src))

console.log('\n[6] a time set on a non-rolling list only reaches TODAY')
/**
 * Grocery, Projects, Someday and any list he made carry no notion of being due
 * on a given date, which is why they are absent from the calendar. A time on
 * one is a real statement about today. On a past date nothing ever recorded
 * that it was meant for that day, so placing it there would invent the
 * schedule this view exists to show honestly.
 */
check('the extra pass is gated on isToday', /if \(isToday\)\{[\s\S]{0,400}ROLLING\.indexOf/.test(src))
check('and it only takes items that actually have a time',
  /if \(!validAt\(x\.at\)\) return;/.test(src))
check('rolling lists are not swept twice',
  /if \(ROLLING\.indexOf\(L\.id\) !== -1\) return;/.test(src))
check('nor is anything already on the day counted twice',
  /if \(already\[L\.id \+ '\|' \+ x\.id\]\) return;/.test(src))

console.log('\n[7] a time survives the roll, in the crossed-off record')
// A daily habit at 07:00 unchecks itself overnight and its doneAt is cleared.
// If the calendar's record did not carry the time, yesterday's 7am item would
// fall out of yesterday's 7am block the moment the day turned.
check('logDone stores the time', /at: x\.at \|\| ''/.test(src))
check('openOn carries it too', /createdAt: born, at: e\.at \|\| ''/.test(src))
check('changing a time updates the record wherever it was crossed',
  /Object\.keys\(state\.done\)\.forEach/.test(grab('setAt')))

console.log(`\n${fails} failure(s)`)
process.exit(fails ? 1 : 0)
