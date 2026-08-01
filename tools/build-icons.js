/**
 * ICON BUILD. Renders icons/mark.svg to every PNG the board needs, at exact
 * pixel sizes, using the Chromium that Playwright already installed here.
 *
 *   cd tools && node build-icons.js
 *
 * WHY A BUILD STEP FOR A ZERO-BUILD BOARD. The PNGs are committed, so the site
 * itself still builds nothing and serves static files. This runs only when the
 * mark changes. Editing a PNG by hand instead would leave the sizes drifting
 * out of sync with each other and with the SVG they came from.
 *
 * WHY PNG AT ALL, WHEN THE SVG IS BETTER. iOS will not accept SVG for
 * apple-touch-icon - PNG only - and it composites WHITE behind transparency,
 * so every one of these is rendered opaque over the mark's own graphite
 * ground. That is the whole reason the home screen icon was blank before.
 */
const { chromium } = require('playwright')
const fs = require('fs')
const path = require('path')

const ICONS = path.join(__dirname, '..', 'icons')
const FULL = fs.readFileSync(path.join(ICONS, 'mark.svg'), 'utf8')
const SMALL = fs.readFileSync(path.join(ICONS, 'mark-small.svg'), 'utf8')
const MASKABLE = fs.readFileSync(path.join(ICONS, 'mark-maskable.svg'), 'utf8')

// Every size, and what actually consumes it. Nothing here is speculative:
// a size is in this list because a real surface asks for it.
//
// `small: true` swaps in the simplified mark. Below roughly 48px the full
// mark's three elements stop reading as three things - see mark-small.svg.
const SIZES = [
  { file: 'apple-touch-icon.png',      px: 180, why: 'iPhone home screen (the default iOS looks for)' },
  { file: 'apple-touch-icon-167.png',  px: 167, why: 'iPad Pro home screen' },
  { file: 'apple-touch-icon-152.png',  px: 152, why: 'iPad home screen' },
  { file: 'apple-touch-icon-120.png',  px: 120, why: 'older iPhone home screen, iOS Spotlight' },
  { file: 'icon-512.png',              px: 512, why: 'web manifest, Android install + splash' },
  { file: 'icon-192.png',              px: 192, why: 'web manifest, Android home screen' },
  { file: 'favicon-32.png',            px: 32,  why: 'browser tab', small: true },
  { file: 'favicon-16.png',            px: 16,  why: 'browser tab, small', small: true },
  { file: 'icon-maskable-512.png',     px: 512, why: 'Android adaptive icon (safe-zone padded)', maskable: true },
]

;(async () => {
  const browser = await chromium.launch()
  for (const s of SIZES) {
    const page = await browser.newPage({ viewport: { width: s.px, height: s.px } })
    // The SVG is sized to the viewport exactly, so the screenshot IS the icon -
    // no scaling, no resampling, no soft edges.
    await page.setContent(
      `<style>html,body{margin:0;padding:0;background:#0f1319}
       svg{display:block;width:${s.px}px;height:${s.px}px}</style>${s.small ? SMALL : s.maskable ? MASKABLE : FULL}`,
      { waitUntil: 'load' }
    )
    await page.screenshot({ path: path.join(ICONS, s.file), omitBackground: false })
    await page.close()
    var tag = s.small ? '[simplified] ' : s.maskable ? '[padded] ' : ''
    console.log(`  ${String(s.px).padStart(4)}px  ${s.file.padEnd(26)} ${tag}${s.why}`)
  }
  await browser.close()
  console.log(`\n${SIZES.length} icons written to icons/`)
})()
