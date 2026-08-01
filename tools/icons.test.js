/**
 * ICON WIRING. Plain node: `node tools/icons.test.js`.
 *
 * Guards the thing that was actually broken: the board shipped with no icons
 * and no icon tags at all, so the iPhone home screen fell back to a blank
 * screenshot. These checks fail loudly if any of that regresses - a dead href,
 * a missing size, or a maskable claim the artwork cannot honour.
 */
const fs = require('fs')
const path = require('path')
const ROOT = path.join(__dirname, '..')
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'site.webmanifest'), 'utf8'))

let fails = 0
const check = (label, cond, extra) => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${cond || !extra ? '' : '  -> ' + extra}`)
  if (!cond) fails++
}

console.log('\n[1] every icon referenced by index.html exists on disk')
const hrefs = [...html.matchAll(/<link[^>]+rel="(?:icon|apple-touch-icon|manifest)"[^>]*href="([^"]+)"/g)].map(m => m[1])
check('index.html references icons at all', hrefs.length >= 6, String(hrefs.length))
hrefs.forEach(h => {
  check(`${h} exists`, fs.existsSync(path.join(ROOT, h)))
})

console.log('\n[2] the iPhone home screen tag iOS actually looks for')
check('has an apple-touch-icon link', /rel="apple-touch-icon"/.test(html))
check('the default (no sizes) one is present - iOS falls back to it',
  /<link rel="apple-touch-icon" href="[^"]+"\s*\/?>/.test(html))
check('180x180 is declared', /rel="apple-touch-icon" sizes="180x180"/.test(html))
check('it is a PNG, never an SVG (iOS ignores SVG here)',
  hrefs.filter(h => h.includes('apple-touch-icon')).every(h => h.endsWith('.png')))

console.log('\n[3] standalone home-screen behaviour')
check('apple-mobile-web-app-capable', /name="apple-mobile-web-app-capable" content="yes"/.test(html))
check('its standard replacement is there too', /name="mobile-web-app-capable" content="yes"/.test(html))
check('status bar style set for viewport-fit=cover',
  /apple-mobile-web-app-status-bar-style" content="black-translucent"/.test(html))
check('short home-screen title, so it does not wrap under the icon',
  /apple-mobile-web-app-title" content="Citadel"/.test(html))

console.log('\n[4] the manifest')
check('links to the manifest', /rel="manifest"/.test(html))
check('display standalone', manifest.display === 'standalone')
check('background matches the board, so the splash is not white',
  manifest.background_color === '#0b0d10', manifest.background_color)
check('has a 192 and a 512', ['192x192', '512x512'].every(s => manifest.icons.some(i => i.sizes === s)))
manifest.icons.forEach(i => check(`manifest icon ${i.src} exists`, fs.existsSync(path.join(ROOT, i.src))))

console.log('\n[5] the maskable claim is one the artwork can honour')
const maskable = manifest.icons.filter(i => (i.purpose || '').includes('maskable'))
check('exactly one maskable icon declared', maskable.length === 1, String(maskable.length))
check('and it is the PADDED variant, not the full-bleed mark',
  maskable.length === 1 && maskable[0].src.includes('maskable'), maskable.map(m => m.src).join(','))

// The real geometry check, recomputed from the artwork rather than trusted.
// Android guarantees only a centred circle of 40% radius (409.6 of 1024); the
// plate is the outermost thing drawn, so its corners are what must fit.
const mark = fs.readFileSync(path.join(ROOT, 'icons', 'mark.svg'), 'utf8')
const build = fs.readFileSync(path.join(__dirname, 'build-icons.js'), 'utf8')

const scale = parseFloat((build.match(/MASKABLE_SCALE\s*=\s*([\d.]+)/) || [])[1])
check('build-icons.js declares a maskable scale', isFinite(scale), String(scale))
check('and applies it to #art, not the whole svg (the ground must stay full bleed)',
  /#art\{[^}]*transform:scale\(/.test(build.replace(/\s+/g, '')) ||
  /#art\{.*transform:scale\(/.test(build))
check('mark.svg actually has the #art group that scaling depends on',
  /<g id="art">/.test(mark))
check('there is no second copy of the artwork to drift',
  !fs.existsSync(path.join(ROOT, 'icons', 'mark-maskable.svg')))

// Pull the plate's own path out of mark.svg and walk it. Absolute M/L/H/V/Z is
// all this path uses, and asserting that keeps the parser honest.
// Found by what it IS (the thing filled with the plate gradient), never by its
// starting coordinates. An earlier version of this matched the literal "M 512
// 72" and, when the plate moved, silently matched nothing - which sent an
// empty point list into Math.max, produced -Infinity, and PASSED the safe
// radius check. A geometry test that passes when it cannot find the geometry
// is worse than no test at all.
const plateD = (mark.match(/<path\s+d="([^"]+)"[^>]*fill="url\(#plate\)"/) || [])[1] || ''
check('found the plate path in mark.svg', !!plateD)
check('the plate uses only absolute M/L/H/V/Z, as this check assumes',
  !!plateD && !/[mlhvcsqtaz]/.test(plateD.replace(/Z/g, '')))

const pts = []
let cx = 0, cy = 0
;(plateD.match(/[MLHV]\s*[-\d.\s]+/g) || []).forEach(tok => {
  const cmd = tok[0]
  const n = tok.slice(1).trim().split(/[\s,]+/).map(Number)
  if (cmd === 'M' || cmd === 'L') { for (let i = 0; i < n.length; i += 2) { cx = n[i]; cy = n[i + 1]; pts.push([cx, cy]) } }
  else if (cmd === 'H') { cx = n[n.length - 1]; pts.push([cx, cy]) }
  else if (cmd === 'V') { cy = n[n.length - 1]; pts.push([cx, cy]) }
})
check('parsed every corner of the plate', pts.length >= 6, String(pts.length))

const strokeW = parseFloat((mark.match(/stroke-width="(\d+)"/) || [])[1]) || 0
// Infinity, not -Infinity, when there is nothing to measure: an unmeasurable
// plate must FAIL the safe-radius check, never sail through it.
const rawWorst = pts.length
  ? Math.max(...pts.map(([x, y]) => Math.hypot(x - 512, y - 512))) + strokeW / 2
  : Infinity
const worst = rawWorst * scale
check(`plate corner ${rawWorst.toFixed(0)} scaled by ${scale} = ${worst.toFixed(0)}, fits the safe radius (409.6)`,
  worst <= 409.6, worst.toFixed(1))
// The other half of the same claim: padding it so hard the mark goes tiny is
// not a fix either. Android's own guidance puts the icon around 60-80% of the
// canvas, so anything under half is a mistake, not caution.
check('...and is not padded into a speck', worst >= 205, worst.toFixed(1))

console.log('\n[6] the sources the PNGs are built from are committed')
;['mark.svg', 'mark-small.svg'].forEach(f =>
  check(`icons/${f} present`, fs.existsSync(path.join(ROOT, 'icons', f))))

console.log(`\n${fails} failure(s)`)
process.exit(fails ? 1 : 0)
