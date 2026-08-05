/**
 * THE SEAL, checked against every tile file. Plain node: `node tiles/sealed.test.js`.
 *
 * Written 2026-08-04 after a real hour was lost to it. Lists grew a "New list"
 * button that asked for the name with prompt(), and a "Delete list" that asked
 * with confirm(). Both worked perfectly with the file opened directly. Both did
 * absolutely nothing on the real board, silently, with an empty console.
 *
 * The cause: a tile runs in sandbox="allow-scripts" with no allow-modals, so
 * the browser blocks prompt/confirm/alert outright - prompt returns null,
 * confirm returns false, and nothing anywhere says why. Code that branches on
 * the answer therefore takes the "cancelled" path forever.
 *
 * The fix is never to add allow-modals. That flag would apply to every tile
 * on the board, including ones fetched from someone else's repo, and a sealed
 * frame that can throw a blocking modal over the whole page is a worse tile
 * than one that cannot ask a question. Anything needing an answer gets built
 * out of elements in the page.
 *
 * So this suite guards both ends: no tile calls a modal, and the host never
 * hands one the permission to.
 */
const fs = require('fs')
const path = require('path')
const dir = __dirname
const root = path.join(dir, '..')

let fails = 0
const check = (label, cond, extra) => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${cond || !extra ? '' : '  -> ' + extra}`)
  if (!cond) fails++
}

/**
 * Comments are stripped before scanning, because this file's own rules get
 * written down in the tiles they apply to - the comment in lists.html says
 * "NO prompt(), NO confirm(), NO alert()" and a naive grep would report the
 * warning as the offence.
 */
function code(src) {
  return src
    .replace(/<!--[\s\S]*?-->/g, ' ')       // html comments
    .replace(/\/\*[\s\S]*?\*\//g, ' ')      // block comments, incl. /** */
    // Line comments, including trailing ones - host.js documents the seal with
    // "// NO allow-same-origin" on the same line as the code that sets it, and
    // scanning that line would report the promise as the breach. The [^:]
    // guard keeps https:// intact.
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

const tiles = fs.readdirSync(dir).filter(f => f.endsWith('.html'))
check('found the tiles to check', tiles.length >= 6, String(tiles.length))

console.log('\n[1] no tile calls a modal, because a sealed frame silently blocks them')
const MODALS = ['prompt', 'confirm', 'alert']
tiles.forEach(f => {
  const src = code(fs.readFileSync(path.join(dir, f), 'utf8'))
  MODALS.forEach(m => {
    // window.prompt(...) and a bare prompt(...). Not this.confirm or .alert on
    // an object of the tile's own, which are fine and are not the browser's.
    const re = new RegExp(`(^|[^.\\w])(window\\s*\\.\\s*)?${m}\\s*\\(`, 'g')
    const hits = src.match(re) || []
    check(`${f}: no ${m}()`, hits.length === 0, hits.join(' '))
  })
})

console.log('\n[2] the host never grants allow-modals, to any tile')
const host = code(fs.readFileSync(path.join(root, 'lib', 'tiles', 'host.js'), 'utf8'))
const sandboxes = [...host.matchAll(/setAttribute\(\s*'sandbox'\s*,\s*'([^']*)'/g)].map(m => m[1])
check('every iframe gets an explicit sandbox', sandboxes.length >= 1, String(sandboxes.length))
sandboxes.forEach((s, i) => {
  check(`sandbox ${i + 1} is exactly allow-scripts`, s.trim() === 'allow-scripts', s)
})
// The other half of the seal, and the reason a tile has no localStorage of its
// own. Worth pinning in the same place.
check('no iframe is given allow-same-origin', !/allow-same-origin/.test(host))

/**
 * THE NOTCH RULE. Added 2026-08-04 after it reached Ruben's phone.
 *
 * env(safe-area-inset-*) RESOLVES INSIDE A SEALED TILE'S IFRAME - measured,
 * not assumed. So a tile that puts those insets on `body` gets them in BOTH
 * modes, and in the grid that is simply wrong: the poster is a small card in
 * the middle of the board, nowhere near the screen edge, and the shell already
 * keeps its own distance from the notch.
 *
 * It is not a cosmetic wrong. An s-sized card is about 122px tall, an iPhone's
 * top inset is about 59px, so half the card became padding and the number was
 * pushed 29px below its own fold. Every desktop check was green, because
 * env() is 0 without a notch.
 *
 * Full screen the tile IS the viewport and genuinely needs the insets, so the
 * rule is not "never" - it is "page mode only". This is a static check on
 * purpose: it runs on every file in tiles/ with no browser and no board, so a
 * tile added next month is covered without anyone remembering this happened.
 */
function safeAreaSelectors(css) {
  const out = []
  let i = 0
  for (;;) {
    const at = css.indexOf('env(safe-area-inset', i)
    if (at === -1) break
    const open = css.lastIndexOf('{', at)
    // The selector runs back to the previous block boundary. For a rule inside
    // an @media, this lands on the inner selector, which is the one that
    // decides whether the declaration applies.
    const prev = Math.max(css.lastIndexOf('}', open), css.lastIndexOf('{', open - 1))
    let sel = css.slice(prev + 1, open).trim().replace(/\s+/g, ' ')
    // The first rule in a file has no previous block boundary, so the slice
    // runs back through the doctype and the head. Report the tail, which is
    // the selector someone can actually go and find.
    if (sel.length > 70) sel = '...' + sel.slice(-70)
    out.push({ sel, at })
    i = at + 1
  }
  return out
}

console.log('\n[3] THE NOTCH: safe-area insets are page mode only, in every tile')
tiles.forEach(f => {
  const css = code(fs.readFileSync(path.join(dir, f), 'utf8'))
  const uses = safeAreaSelectors(css)
  const loose = uses.filter(u => u.sel.indexOf('data-mode="page"') === -1)
  check(`${f}: no safe-area inset outside page mode`, loose.length === 0,
    loose.map(u => u.sel).join(' | '))
})
// And the rule has to actually be used somewhere, or a tile that simply never
// handles the notch at all would pass by doing nothing.
const pageTiles = tiles.filter(f => /data-mode="page"/.test(fs.readFileSync(path.join(dir, f), 'utf8')))
check('every tile with a full-screen page honours the notch there',
  pageTiles.every(f => safeAreaSelectors(code(fs.readFileSync(path.join(dir, f), 'utf8'))).length > 0),
  pageTiles.filter(f => !safeAreaSelectors(code(fs.readFileSync(path.join(dir, f), 'utf8'))).length).join(', '))

console.log('\n[4] and the tiles that ask questions do it with elements')
// Lists is the one that needed an answer twice. Both are built in the page.
const lists = fs.readFileSync(path.join(dir, 'lists.html'), 'utf8')
check('naming a list uses an input', /id="newListName"/.test(lists))
check('deleting a list arms a button instead of confirming',
  /armedDelete/.test(lists) && /Tap again to delete/.test(lists))
check('setting a time uses a native time input', /el\.type = 'time'/.test(lists))

console.log(`\n${fails} failure(s)`)
process.exit(fails ? 1 : 0)
