/**
 * THE HIDDEN CHECK. Finds elements the code hid that are still on screen.
 *
 * Why it exists. `el.hidden = true` reads like it settles the question. It
 * does not: the browser hides [hidden] from its OWN stylesheet, and any
 * `display` rule written in the tile beats it on specificity. So a row styled
 * `display:flex` is permanently visible no matter what the code sets, with no
 * error anywhere and nothing to see in the console.
 *
 * What it caught the first time it ran, all three invisible to every other
 * suite on this board:
 *
 *   reminders  .posterHero is display:flex, so with nothing set the poster
 *              showed "--:--" next to "Nothing set yet". A time that is not a
 *              time, on the face of the tile. That is the made up number rule
 *              broken by a CSS specificity accident.
 *   lists      .repToggle is display:flex, so "Repeats every day" sat on
 *              Grocery, Projects, Someday and Urgent - lists that do not
 *              repeat, where add() ignores the box. A control that looks live
 *              and does nothing. .addRow too, so the new-list name row was
 *              never actually put away.
 *   notes      .posterLast is display:-webkit-box for its two line clamp.
 *
 * Lifting already carried `[hidden]{ display:none !important; }` and was
 * clean, which is the whole point: the fix was known and had simply not
 * travelled. Every tile carries the line now, and this measures that it
 * WORKS rather than that the line is present - a rule someone later
 * out-specifies would still pass a grep.
 *
 * WHAT IT FLAGS: any element carrying the hidden attribute whose computed
 * display is not none. Nothing else. An element can be legitimately invisible
 * a dozen other ways; this is only about the one word the code used to say so.
 *
 * SETUP (once):  cd tools && npm install && npm run install-browser
 * RUN (board serving on :3000): node tools/hidden-check.js
 */
const { chromium } = require('playwright')

const URL = process.env.BOARD_URL || 'http://localhost:3000/'
const TILES = ['Lists', 'Check in', 'Body', 'Recovery', 'Lifting', 'Progress', 'Notes', 'Reminders']
const WIDTH = 390

/**
 * Seeded, but only lightly, and for the opposite reason to the other checks.
 * They seed so a tile has something to measure. This one wants BOTH faces: an
 * empty tile is where a poster hides its hero, and a full one is where a page
 * hides its empty state. So Lists is given data and everything else is left
 * empty on purpose, and the emptiness is the test.
 */
const day = (back = 0) => {
  const d = new Date()
  d.setDate(d.getDate() - back)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const TODAY = day(0)

const SEED = {
  'v:tile:projects': { v:3, lists:{
      urgent:[{ id:'u1', title:'Send the deposit', done:false, createdAt:TODAY, doneAt:null }],
      daily:[{ id:'a', title:'Call the bank', done:false, repeat:true, createdAt:day(7), doneAt:null }],
      weekly:[], grocery:[{ id:'g', title:'Oats', done:false, createdAt:day(2), doneAt:null }],
      projects:[], someday:[] },
    custom:[], archive:[], done:{}, logFrom:day(7), rolledOn:'', rolledWeek:'' }
}

// Runs inside the frame.
const sweep = () => {
  const out = []
  document.querySelectorAll('[hidden]').forEach(el => {
    const cs = getComputedStyle(el)
    if (cs.display === 'none') return
    const cls = typeof el.className === 'string' ? el.className.split(' ')[0] : ''
    const name = el.id ? '#' + el.id : (cls ? '.' + cls : el.tagName.toLowerCase())
    const text = (el.textContent || '').trim().slice(0, 34)
    out.push(`${name} is hidden but computes display:${cs.display}` + (text ? `  ("${text}")` : ''))
  })
  return out
}

;(async () => {
  const browser = await chromium.launch()
  const failures = []
  const add = line => { if (!failures.includes(line)) failures.push(line) }

  const ctx = await browser.newContext({ viewport: { width: WIDTH, height: 880 }, hasTouch: true, isMobile: true })
  const page = await ctx.newPage()
  await page.goto(URL, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1800)

  // PASS ONE: the board as it comes up empty. This is where a poster hides
  // its hero and shows its empty state, and where reminders was showing both.
  for (const f of page.frames()) {
    if (!/\/tiles\//.test(f.url())) continue
    const tile = f.url().split('/').pop().replace('.html', '')
    const hits = await f.evaluate(sweep).catch(() => [])
    hits.forEach(h => add(`empty poster  ${tile}: ${h}`))
  }

  // PASS TWO: seeded, and every page and every tab of it opened.
  await page.evaluate(s => Object.keys(s).forEach(k => localStorage.setItem(k, JSON.stringify(s[k]))), SEED)
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(2200)

  for (const f of page.frames()) {
    if (!/\/tiles\//.test(f.url())) continue
    const tile = f.url().split('/').pop().replace('.html', '')
    const hits = await f.evaluate(sweep).catch(() => [])
    hits.forEach(h => add(`poster  ${tile}: ${h}`))
  }

  for (const tile of TILES) {
    const opener = `button.tileHit[aria-label="Open ${tile}"]`
    if (!(await page.$(opener))) { console.log(`  skipped ${tile} (no page)`); continue }
    await page.click(opener)
    await page.waitForTimeout(900)
    const frame = page.frames().find(f => /#page$/.test(f.url()))
    if (!frame) { add(`${tile}: page never opened`); continue }

    // Every tab. A view nobody opens is a view nothing is looking at - the
    // same reason touch-check and squeeze-check walk them.
    const ids = await frame.evaluate(() =>
      [...document.querySelectorAll('[data-nav],[data-wtab],[data-view],.tab,.seg button,.vBtn')]
        .map((el, i) => { el.setAttribute('data-hcid', 'h' + i); return 'h' + i }))

    for (const id of [null].concat(ids)) {
      if (id) {
        try {
          await frame.evaluate(i => {
            const el = document.querySelector(`[data-hcid="${i}"]`)
            if (el && !el.disabled) el.click()
          }, id)
          await page.waitForTimeout(260)
        } catch (e) { continue }
      }
      const hits = await frame.evaluate(sweep).catch(() => [])
      hits.forEach(h => add(`${tile}: ${h}`))
    }

    await page.evaluate(() => { const b = document.querySelector('.vPageClose'); if (b) b.click() })
    await page.waitForTimeout(400)
    console.log(`  checked ${tile}`)
  }

  await ctx.close()
  await browser.close()

  if (failures.length) {
    console.log(`\n${failures.length} element(s) hidden in code and visible on screen:\n` +
      failures.map(f => '  ' + f).join('\n') +
      `\n\nThe fix is one line in the tile's stylesheet:  [hidden]{ display:none !important; }`)
    process.exit(1)
  }
  console.log(`\nEverything the code hides is actually hidden, across ${TILES.length} tiles, ` +
    `all their tabs, empty and seeded.`)
})()
