/**
 * The Notes tile's own logic, pulled out of tiles/notes.html.
 * Plain node: `node tiles/notes.test.js`.
 *
 * The one worth guarding above all others: THE TITLE IS NOT STORED. It is the
 * first non-empty line of the body, computed every time. The moment a title is
 * kept beside the text, the two can disagree - rename the note and the first
 * line still says the old thing - and nothing on screen would show it.
 */
const fs = require('fs')
const vm = require('vm')
const path = require('path')
const src = fs.readFileSync(path.join(__dirname, 'notes.html'), 'utf8')

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

const NOW = new Date('2026-08-04T15:00:00.000Z')
const sandbox = { console }
sandbox.Date = class extends Date {
  constructor(...a) { if (!a.length) super(NOW.getTime()); else super(...a) }
}
vm.createContext(sandbox)
vm.runInContext(`
  var state = { v:1, notes: [] };
  ${grab('titleOf')}
  ${grab('previewOf')}
  ${grab('sorted')}
  ${grab('two')}
  ${grab('dayKey')}
  ${grab('whenOf')}
`, sandbox)

let fails = 0
const check = (label, cond, extra) => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${cond || !extra ? '' : '  -> ' + extra}`)
  if (!cond) fails++
}
const { titleOf, previewOf, whenOf } = sandbox

console.log('\n[1] the title is the first line, and only ever computed')
check('first line wins', titleOf({ body: 'Gym plan\nPush Monday' }) === 'Gym plan',
  titleOf({ body: 'Gym plan\nPush Monday' }))
check('leading blank lines are skipped',
  titleOf({ body: '\n\n  Groceries\nolive oil' }) === 'Groceries',
  titleOf({ body: '\n\n  Groceries\nolive oil' }))
check('a one-line note is all title', titleOf({ body: 'Call the bank' }) === 'Call the bank')
check('an empty note has no title, rather than a made-up one',
  titleOf({ body: '' }) === '' && titleOf({ body: '   \n  ' }) === '')
check('a missing body does not throw', titleOf({}) === '')
// Long enough to break the row, so it is cut with something that says it was.
const long = 'x'.repeat(200)
check('a very long first line is truncated visibly',
  titleOf({ body: long }).length === 63 && /\.\.\.$/.test(titleOf({ body: long })),
  String(titleOf({ body: long }).length))

console.log('\n[2] editing the first line renames the note, because nothing else holds a name')
// This is the whole reason the title is derived. If a title were stored, this
// note would still be called "Gym plan" after the rename.
const n = { id: 'a', body: 'Gym plan\nPush Monday' }
check('before', titleOf(n) === 'Gym plan')
n.body = 'Training plan\nPush Monday'
check('after editing line one', titleOf(n) === 'Training plan', titleOf(n))
check('nothing in the file stores a title alongside the body',
  !/\btitle:\s/.test(src.replace(/<!--[\s\S]*?-->/g, '')),
  (src.match(/\btitle:\s.*/) || [''])[0])

console.log('\n[3] the preview is everything after the title')
check('rest of the note, flattened',
  previewOf({ body: 'Gym plan\nPush Monday\nDeload after' }) === 'Push Monday Deload after',
  previewOf({ body: 'Gym plan\nPush Monday\nDeload after' }))
check('a one-line note has no preview', previewOf({ body: 'Call the bank' }) === '')
check('blank lines between do not become spaces',
  previewOf({ body: 'A\n\n\nB' }) === 'B', previewOf({ body: 'A\n\n\nB' }))
check('an empty note has no preview', previewOf({ body: '' }) === '')

console.log('\n[4] newest edit first')
sandbox.state.notes = [
  { id: 'old',  body: 'old',  updatedAt: '2026-08-01T09:00:00.000Z' },
  { id: 'new',  body: 'new',  updatedAt: '2026-08-04T09:00:00.000Z' },
  { id: 'mid',  body: 'mid',  updatedAt: '2026-08-02T09:00:00.000Z' }
]
check('sorted by updatedAt descending',
  sandbox.sorted().map(x => x.id).join(',') === 'new,mid,old',
  sandbox.sorted().map(x => x.id).join(','))
// Two notes written the same morning have to sort against each other, which a
// date key alone cannot do. This is why the timestamps are full ISO.
sandbox.state.notes = [
  { id: 'a', body: 'a', updatedAt: '2026-08-04T09:00:00.000Z' },
  { id: 'b', body: 'b', updatedAt: '2026-08-04T14:30:00.000Z' }
]
check('two notes on the same day still order correctly',
  sandbox.sorted().map(x => x.id).join(',') === 'b,a',
  sandbox.sorted().map(x => x.id).join(','))
// A row restored from a blob written before timestamps, or a half-written one.
// It must sort to the bottom and it must not take the list down with it.
sandbox.state.notes = [
  { id: 'stamped', body: 'a', updatedAt: '2026-08-04T09:00:00.000Z' },
  { id: 'bare',    body: 'b' }
]
check('a note with no timestamp sinks rather than throwing',
  sandbox.sorted().map(x => x.id).join(',') === 'stamped,bare',
  sandbox.sorted().map(x => x.id).join(','))

console.log('\n[5] how long ago, in the words a person uses')
check('just now', whenOf('2026-08-04T14:59:40.000Z') === 'now', whenOf('2026-08-04T14:59:40.000Z'))
check('minutes', whenOf('2026-08-04T14:30:00.000Z') === '30m', whenOf('2026-08-04T14:30:00.000Z'))
check('hours, same day', whenOf('2026-08-04T11:00:00.000Z') === '4h', whenOf('2026-08-04T11:00:00.000Z'))
check('no timestamp says nothing rather than "Invalid Date"', whenOf('') === '' && whenOf(null) === '')
check('a nonsense timestamp says nothing too', whenOf('banana') === '', whenOf('banana'))

console.log('\n[6] the tile reports nothing, and that is deliberate')
/**
 * A tile reports ONE honest number or none. There is no honest number in a
 * note: a count of them is not progress toward getting stronger, feeling good
 * or showing up. Reporting one would put a meaningless row in the ledger and
 * then invite a weight in weights.ts to make it mean something.
 */
check('no Vitality.report call anywhere in the tile',
  !/Vitality\.report\(/.test(src.replace(/report: function[^\n]*\n/, '')),
  (src.match(/Vitality\.report\([\s\S]{0,60}/) || [''])[0])
const weights = fs.readFileSync(path.join(__dirname, '..', 'lib', 'tiles', 'weights.ts'), 'utf8')
check('and no weight in the equation', !/\bnotes:\s*\d/.test(weights),
  (weights.match(/\bnotes:\s*\d.*/) || [''])[0])
check('the absence is explained where someone would look for it',
  /`notes` is absent/.test(weights))

console.log('\n[7] the tile is registered, and honest about the seal')
const reg = fs.readFileSync(path.join(__dirname, '..', 'lib', 'tiles', 'registry.js'), 'utf8')
check('one line in the registry', /id: 'notes'/.test(reg))
check('pointing at the file that exists', /file: 'tiles\/notes\.html'/.test(reg))
// The id is the vault storage key. Changing it later orphans every note.
check('the id is the storage key and it is "notes"', /\{ id: 'notes',/.test(reg))
check('an empty note is dropped rather than left as a blank row',
  /a New tapped by accident/.test(src))
check('saving is debounced, not per keystroke', /saveTimer = setTimeout/.test(src))
check('and flushed when the page goes away', /pagehide/.test(src) && /visibilitychange/.test(src))

console.log(`\n${fails} failure(s)`)
process.exit(fails ? 1 : 0)
