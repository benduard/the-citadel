/**
 * THE CLOSE-BUTTON LANE. `node tools/collision-check.js` (board on :3000).
 *
 * The host floats a close button over the top right of every page tile. Three
 * separate times now something in a tile's own header has ended up underneath
 * it: the shell's Library gear vs the sync pill, the Body tile's unit toggle,
 * and the Lists tile's count pill. Each was found by eye, one at a time, after
 * shipping - and every plain-node test stayed green through all three, because
 * the overlap only exists once a real browser has laid both documents out.
 *
 * So it gets a permanent check. This opens every page tile at a spread of real
 * device widths and measures whether anything interactive or informative in
 * the tile's header actually intersects the host's button.
 *
 * NOTE the breakpoint trap this exists to catch: the right answer is not one
 * shared number. The button sits at viewport-52, so the width at which a tile
 * clears it depends on that tile's own column width. Copying the Body tile's
 * 640px into the wider Lists tile left a 4px overlap at 700px.
 */
const { chromium } = require('playwright')

const URL = process.env.BOARD || 'http://localhost:3000/'
const WIDTHS = [320, 375, 390, 414, 430, 500, 600, 640, 700, 708, 760, 820, 900, 1024, 1280, 1440]

// Every tile the host opens full screen, by the aria-label it gives the opener.
const TILES = ['Lists', 'Check in', 'Body', 'Recovery', 'Lifting', 'Progress', 'Notes']

// Anything in a tile header worth protecting: it either says a number or it
// is tappable. A label that gets covered is a lie; a control that gets covered
// is unusable.
const HEADER_SEL = '.head, .pageHead, .pageHero, .cmdbar, [data-header]'

;(async () => {
  const browser = await chromium.launch()
  const failures = []

  for (const tile of TILES) {
    for (const w of WIDTHS) {
      const page = await browser.newPage({ viewport: { width: w, height: 900 } })
      try {
        await page.goto(URL, { waitUntil: 'networkidle' })
        await page.waitForTimeout(500)
        const opener = `button.tileHit[aria-label="Open ${tile}"]`
        if (!(await page.$(opener))) { await page.close(); continue }
        await page.click(opener)
        await page.waitForTimeout(900)

        // The close button lives in the HOST document, painted above the frame.
        const close = await page.evaluate(() => {
          const cands = [...document.querySelectorAll('button')]
            .filter(b => ['fixed', 'absolute'].includes(getComputedStyle(b).position))
            .map(b => b.getBoundingClientRect())
            .filter(r => r.width > 20 && r.width < 80 && r.top < 120 &&
                         r.right > window.innerWidth - 120)
            .sort((a, b) => a.top - b.top)
          const c = cands[0]
          return c ? { left: c.left, right: c.right, top: c.top, bottom: c.bottom } : null
        })
        if (!close) { await page.close(); continue }

        const frame = page.frames().find(f => /#page$/.test(f.url()))
        if (!frame) { await page.close(); continue }

        const hits = await frame.evaluate(sel => {
          const out = []
          document.querySelectorAll(sel).forEach(h => {
            // Leaf elements only: a wrapper spanning the full width always
            // "overlaps" and would drown the real signal.
            h.querySelectorAll('*').forEach(el => {
              if (el.children.length) return
              const t = (el.textContent || '').trim()
              const tappable = ['BUTTON', 'A', 'INPUT', 'SELECT'].includes(el.tagName)
              if (!t && !tappable) return
              const r = el.getBoundingClientRect()
              if (!r.width || !r.height) return
              out.push({ tag: el.tagName, text: t.slice(0, 24), l: r.left, r: r.right, t: r.top, b: r.bottom })
            })
          })
          return out
        }, HEADER_SEL)

        for (const el of hits) {
          const ox = Math.min(el.r, close.right) - Math.max(el.l, close.left)
          const oy = Math.min(el.b, close.bottom) - Math.max(el.t, close.top)
          if (ox > 0 && oy > 0) {
            failures.push(`${tile} @ ${w}px: "${el.text}" (${el.tag}) under the close button by ${Math.round(ox)}x${Math.round(oy)}px`)
          }
        }
      } catch (e) {
        failures.push(`${tile} @ ${w}px: check itself failed - ${e.message}`)
      }
      await page.close()
    }
    process.stdout.write(`  checked ${tile}\n`)
  }

  await browser.close()

  if (failures.length) {
    console.log('\nCOLLISIONS:')
    failures.forEach(f => console.log('  ' + f))
    console.log(`\n${failures.length} collision(s).`)
    process.exit(1)
  }
  console.log(`\nNo header sits under the close button, across ${TILES.length} tiles x ${WIDTHS.length} widths.`)
})()
