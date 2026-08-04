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

console.log('\n[3] and the tiles that ask questions do it with elements')
// Lists is the one that needed an answer twice. Both are built in the page.
const lists = fs.readFileSync(path.join(dir, 'lists.html'), 'utf8')
check('naming a list uses an input', /id="newListName"/.test(lists))
check('deleting a list arms a button instead of confirming',
  /armedDelete/.test(lists) && /Tap again to delete/.test(lists))
check('setting a time uses a native time input', /el\.type = 'time'/.test(lists))

console.log(`\n${fails} failure(s)`)
process.exit(fails ? 1 : 0)
