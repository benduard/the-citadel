/**
 * TOUCH TARGETS. `node tools/touch-check.js` (board running on :3000).
 *
 * Every mobile sizing problem on this board so far was found by Ruben on his
 * phone, not by a test: the close button under the status bar, the Body tile's
 * unit toggle behind it, and a whole set of 32-36px controls that read fine
 * with a mouse and are under Apple's 44px minimum with a thumb.
 *
 * Plain-node tests cannot see any of it - a control's real size only exists
 * once a browser has laid the page out - and neither can a desktop run, because
 * the fixes are scoped to @media (pointer: coarse). So this drives a real
 * touch context and measures.
 *
 * WHAT IT DELIBERATELY DOES NOT FLAG:
 *  - inputs inside a <label>: the label is the tap target, so the label is
 *    what gets measured and the inner input is skipped rather than counted
 *    twice at its own smaller size.
 *  - captions: a <label> with no control inside it is a caption pointing at a
 *    field, not something you tap. Measuring those produced four false
 *    positives the first time this ran.
 *  - controls that grow their hit area with a pseudo-element (the Check in
 *    switch keeps its familiar 56x32 look and pads ::after by 6px). The
 *    computed hit box is used, not the border box.
 */
const { chromium } = require('playwright')

const URL = process.env.BOARD || 'http://localhost:3000/'
const TILES = ['Lists', 'Check in', 'Body', 'Recovery', 'Lifting', 'Progress']
const MIN = 44

// Compact controls that live inside a dense row and have a full-size path to
// the same action elsewhere. Exempt on purpose, not overlooked.
const EXEMPT = /^(Use|Edit|Repeat|Remove|↑|↓|×)$/

;(async () => {
  const browser = await chromium.launch()
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true
  })
  const page = await ctx.newPage()
  const failures = []

  await page.goto(URL, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1200)

  const coarse = await page.evaluate(() => matchMedia('(pointer: coarse)').matches)
  if (!coarse) {
    console.log('FAIL: the context is not reporting a coarse pointer, so this check proves nothing.')
    await browser.close()
    process.exit(1)
  }

  // One argument: Playwright's evaluate takes a single serialisable value.
  const sweep = ({ min, exemptSrc }) => {
    const out = []
    const seen = new Set()
    const exempt = new RegExp(exemptSrc)
    document.querySelectorAll('button, select, textarea, label, [role="button"]').forEach(el => {
      if (el.disabled) return
      // An input inside a label is tapped through the label.
      if (el.tagName === 'INPUT' && el.closest('label')) return
      // A label with no control inside is a caption, not a target.
      if (el.tagName === 'LABEL' && !el.querySelector('input,select,textarea,button')) return
      const r = el.getBoundingClientRect()
      if (!r.width || !r.height) return

      // Grow the measured box by any pseudo-element hit padding.
      let top = 0, bottom = 0, left = 0, right = 0
      for (const pseudo of ['::before', '::after']) {
        const cs = getComputedStyle(el, pseudo)
        if (cs.content === 'none' || cs.position !== 'absolute') continue
        const px = v => (v && v.endsWith('px')) ? -parseFloat(v) : 0
        top = Math.max(top, px(cs.top)); bottom = Math.max(bottom, px(cs.bottom))
        left = Math.max(left, px(cs.left)); right = Math.max(right, px(cs.right))
      }
      const h = r.height + top + bottom
      const w = r.width + left + right

      const label = (el.getAttribute('aria-label') || el.textContent || el.id || el.tagName)
        .trim().replace(/\s+/g, ' ').slice(0, 30)
      if (exempt.test(label)) return
      if (h >= min && w >= min) return
      const key = label + '|' + Math.round(w) + 'x' + Math.round(h)
      if (seen.has(key)) return
      seen.add(key)
      out.push(`${label} (${Math.round(w)}x${Math.round(h)})`)
    })
    return out
  }

  for (const tile of TILES) {
    const opener = `button.tileHit[aria-label="Open ${tile}"]`
    if (!(await page.$(opener))) continue
    await page.click(opener)
    await page.waitForTimeout(900)
    const frame = page.frames().find(f => /#page$/.test(f.url()))
    if (!frame) { failures.push(`${tile}: page never opened`); continue }

    // Walk every tab this tile offers, so controls that only exist inside a
    // sub-view are measured too. The first version of this check only saw
    // each tile's default view and missed most of what was wrong.
    const ids = await frame.evaluate(() =>
      [...document.querySelectorAll('[data-nav],[data-wtab],[data-view],.tab,.seg button,.vBtn')]
        .map((el, i) => { el.setAttribute('data-touchid', 't' + i); return 't' + i }))

    const views = [null].concat(ids)
    for (const id of views) {
      if (id) {
        try {
          await frame.evaluate(i => {
            const el = document.querySelector(`[data-touchid="${i}"]`)
            if (el && !el.disabled) el.click()
          }, id)
          await page.waitForTimeout(320)
        } catch (e) { continue }
      }
      const small = await frame.evaluate(sweep, { min: MIN, exemptSrc: EXEMPT.source })
      small.forEach(s => {
        const line = `${tile}: ${s}`
        if (!failures.includes(line)) failures.push(line)
      })
    }

    await page.evaluate(() => { const b = document.querySelector('.vPageClose'); if (b) b.click() })
    await page.waitForTimeout(400)
    console.log(`  checked ${tile}`)
  }

  await browser.close()
  if (failures.length) {
    console.log(`\n${failures.length} control(s) under ${MIN}px on a touch screen:\n` +
      failures.map(f => '  ' + f).join('\n'))
    process.exit(1)
  }
  console.log(`\nEvery control clears ${MIN}px on a touch screen, across ${TILES.length} tiles and all their tabs.`)
})()
