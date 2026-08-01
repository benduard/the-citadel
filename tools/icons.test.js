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
// The real geometry check: the wall corners of the padded mark must sit inside
// the 40%-radius safe circle Android guarantees.
const mask = fs.readFileSync(path.join(ROOT, 'icons', 'mark-maskable.svg'), 'utf8')
const scale = parseFloat((mask.match(/scale\(([\d.]+)\)/) || [])[1])
check('padded variant declares a scale', isFinite(scale), String(scale))
const corners = [[270,158],[754,158],[866,270],[866,754],[754,866],[270,866],[158,754],[158,270]]
const worst = Math.max(...corners.map(([x, y]) => Math.hypot((x - 512) * scale, (y - 512) * scale)))
check(`scaled wall corner (${worst.toFixed(0)}) fits the safe radius (409.6)`, worst <= 409.6, worst.toFixed(1))

console.log('\n[6] the sources the PNGs are built from are committed')
;['mark.svg', 'mark-small.svg', 'mark-maskable.svg'].forEach(f =>
  check(`icons/${f} present`, fs.existsSync(path.join(ROOT, 'icons', f))))

console.log(`\n${fails} failure(s)`)
process.exit(fails ? 1 : 0)
