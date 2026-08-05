/**
 * THE SQUEEZE CHECK. Finds text crushed so narrow it reads as a vertical
 * column of letters instead of a line of words.
 *
 * Why it exists. Ruben reported his task titles running vertically on the
 * phone. The cause was a flex row: Lists' item row carries a checkbox, the
 * title, up to two tags, a time input, a move select and a remove button, and
 * their fixed widths added to 335px on a 284px row. The title was the only
 * flexible thing, and `min-width:0` let it give ALL of its width - it measured
 * literally 0px wide, wrapping one character per line.
 *
 * Nothing else could have caught it. Every node suite was green, the tile
 * painted, no control was under 44px, no number overflowed, and there was no
 * console error. The layout was "valid" and unreadable.
 *
 * WHAT IT FLAGS: a text element rendering over more lines than it has business
 * needing - fewer than about two and a half characters per line - or one whose
 * box is narrower than two characters. Leaf elements only, so a container is
 * never blamed for its children.
 *
 * SETUP (once):  cd tools && npm install && npm run install-browser
 * RUN (board serving on :3000): node tools/squeeze-check.js
 */
const { chromium } = require('playwright')

const URL = process.env.BOARD_URL || 'http://localhost:3000/'
const TILES = ['Lists', 'Check in', 'Body', 'Recovery', 'Lifting', 'Progress', 'Notes']
// 320 is the narrowest phone that has to work; 430 is a Pro Max. If it reads
// at 320 it reads everywhere.
const WIDTHS = [320, 390]

// Seeded so the rows that actually carry text exist. A tile showing its empty
// state has nothing to squeeze, and would pass by having nothing to measure -
// the same trap tools/number-check.js already had to close once.
const SEED = {
  'v:tile:projects': { v:3, lists:{
      daily:[
        { id:'a', title:'Call the bank about the mortgage', done:false, repeat:true, createdAt:'2026-07-08', doneAt:null },
        { id:'b', title:'Stretch', done:false, repeat:false, createdAt:'2026-07-08', doneAt:null }],
      weekly:[{ id:'c', title:'Meal prep for the week', done:false, repeat:true, createdAt:'2026-07-08', doneAt:null }],
      grocery:[{ id:'d', title:'Olive oil', done:false, createdAt:'2026-08-01', doneAt:null }],
      projects:[{ id:'e', title:'Finish the board', done:false, createdAt:'2026-07-01', doneAt:null }],
      someday:[{ id:'f', title:'Learn to sail properly', done:false, createdAt:'2026-07-01', doneAt:null }] },
    custom:[], archive:[], done:{}, logFrom:'2026-07-01', rolledOn:'', rolledWeek:'' },
  'v:tile:checkin': { days:{ '2026-08-04':
    { mood:8, energy:7, focus:9, stress:3, soreness:3, water:6, supps:true, note:'Felt strong today' } } },
  'v:tile:body': { unit:'kg', days:{ '2026-08-04': 102.4, '2026-08-03': 102.9 } },
  'v:tile:recovery': { days:{ '2026-08-04': { sleepH:7.5, hrv:68, rhr:52, resp:14.2 } } },
  'v:tile:lifting': { v:2, unit:'kg', bw:102.4, weekTarget:3, rest:120, restAuto:true,
    days:{ '2026-08-04':[
      { id:'s1', ex:'Back Squat', kg:140, reps:5, rpe:8, note:'' },
      { id:'s2', ex:'Romanian Deadlift', kg:100, reps:8, rpe:7, note:'' }] },
    notes:{}, routines:[], custom:[], claimed:{}, lvlSeen:1, rankSeen:{},
    splits:{ '2026-08-04':'legs' }, routineToday:{}, deloads:{},
    scheme:'yours', customSplits:[], attempts:[], uni:{} },
  'v:tile:progress': { v:1, quests:[{ id:'q1', title:'Train four times this week', done:true, createdAt:'2026-08-01' }], retired:0, xp:1250 },
  'v:tile:notes': { v:1, notes:[
    { id:'n1', body:'Gym plan\nPush Monday, pull Wednesday', createdAt:'2026-08-04T09:00:00.000Z', updatedAt:'2026-08-04T09:00:00.000Z' }] }
}

/**
 * Runs inside the frame. Leaf text elements only - an element with element
 * children is a container, and blaming it for a squeezed child would point at
 * the wrong thing twice.
 */
const sweep = () => {
  const out = []
  const seen = new Set()
  document.querySelectorAll('*').forEach(el => {
    if (el.children.length) return
    // SVG text does not wrap and has no meaningful scrollHeight. Measuring it
    // the way HTML is measured produced nonsense - an 11-line reading on a
    // chart label that is one line by construction.
    if (el.namespaceURI && el.namespaceURI.indexOf('svg') !== -1) return
    const text = (el.textContent || '').trim()
    // Under four characters cannot meaningfully "read vertically", and a
    // one-letter label is a real thing (a day initial on a chart).
    if (text.length < 4) return
    const r = el.getBoundingClientRect()
    /**
     * HEIGHT ONLY. Not `!r.width || !r.height`.
     *
     * The first cut skipped anything zero-width as "not rendered" - and a
     * squeezed title is EXACTLY zero-width while being very tall. The check
     * was structurally blind to the one thing it was written to find, and said
     * "no text is squeezed" with the original bug restored in the file. Only
     * the mutation test caught that; it looked completely correct.
     *
     * Something genuinely unrendered has no height and no client rects, both
     * of which are still filtered.
     */
    if (!r.height) return
    const cs = getComputedStyle(el)
    if (cs.visibility === 'hidden' || cs.display === 'none') return
    // Anything deliberately vertical is not a bug. Nothing on this board is,
    // but a check that cannot tell the difference would be wrong later.
    if (cs.writingMode && cs.writingMode.indexOf('vertical') === 0) return

    /**
     * THE LINE COUNT COMES FROM THE TEXT, NOT THE BOX.
     *
     * The first cut of this divided scrollHeight by line-height, which counts
     * PADDING as text: a 231px-wide "Log set" button reported three lines and
     * the check drowned in false positives - every button on the board. A
     * Range over the element's contents returns one rectangle per rendered
     * line of text, which is the thing actually being asked about.
     */
    const range = document.createRange()
    range.selectNodeContents(el)
    const rects = range.getClientRects()
    const lines = rects.length
    if (!lines) return
    const perLine = text.length / lines
    // Three or more lines averaging under two and a half characters is text
    // reading downward, not across.
    if (lines < 3 || perLine >= 2.5) return

    let widest = 0
    for (let i = 0; i < rects.length; i++) widest = Math.max(widest, rects[i].width)
    const cls = typeof el.className === 'string' ? el.className : ''
    const where = cls ? '.' + cls.split(' ')[0] : el.tagName.toLowerCase()
    const key = where + '|' + text.slice(0, 20)
    if (seen.has(key)) return
    seen.add(key)
    out.push(`"${text.slice(0, 28)}" in ${where} - text ${Math.round(widest)}px wide, ` +
      `${lines} lines for ${text.length} chars`)
  })
  return out
}

;(async () => {
  const browser = await chromium.launch()
  const failures = []

  for (const width of WIDTHS) {
    const ctx = await browser.newContext({ viewport: { width, height: 880 }, hasTouch: true, isMobile: true })
    const page = await ctx.newPage()
    await page.goto(URL, { waitUntil: 'networkidle' })
    await page.evaluate(s => Object.keys(s).forEach(k => localStorage.setItem(k, JSON.stringify(s[k]))), SEED)
    await page.reload({ waitUntil: 'networkidle' })
    await page.waitForTimeout(2200)

    // The grid's own posters, before opening anything.
    for (const f of page.frames()) {
      if (!/\/tiles\//.test(f.url())) continue
      const hits = await f.evaluate(sweep).catch(() => [])
      hits.forEach(h => {
        const line = `${width}px  poster ${f.url().split('/').pop().replace('.html', '')}: ${h}`
        if (!failures.includes(line)) failures.push(line)
      })
    }

    for (const tile of TILES) {
      const opener = `button.tileHit[aria-label="Open ${tile}"]`
      if (!(await page.$(opener))) continue
      await page.click(opener)
      await page.waitForTimeout(900)
      const frame = page.frames().find(f => /#page$/.test(f.url()))
      if (!frame) { failures.push(`${width}px  ${tile}: page never opened`); continue }

      // Every tab, the same way touch-check does it: a view you never open is
      // a view nothing is looking at.
      const ids = await frame.evaluate(() =>
        [...document.querySelectorAll('[data-nav],[data-wtab],[data-view],.tab,.seg button,.vBtn')]
          .map((el, i) => { el.setAttribute('data-sqid', 's' + i); return 's' + i }))

      for (const id of [null].concat(ids)) {
        if (id) {
          try {
            await frame.evaluate(i => {
              const el = document.querySelector(`[data-sqid="${i}"]`)
              if (el && !el.disabled) el.click()
            }, id)
            await page.waitForTimeout(300)
          } catch (e) { continue }
        }
        const hits = await frame.evaluate(sweep).catch(() => [])
        hits.forEach(h => {
          const line = `${width}px  ${tile}: ${h}`
          if (!failures.includes(line)) failures.push(line)
        })
      }

      await page.evaluate(() => { const b = document.querySelector('.vPageClose'); if (b) b.click() })
      await page.waitForTimeout(400)
      console.log(`  ${width}px  checked ${tile}`)
    }
    await ctx.close()
  }

  await browser.close()
  if (failures.length) {
    console.log(`\n${failures.length} piece(s) of text squeezed into a column:\n` +
      failures.map(f => '  ' + f).join('\n'))
    process.exit(1)
  }
  console.log(`\nNo text is squeezed into a vertical column, across ${TILES.length} tiles, ` +
    `all their tabs, at ${WIDTHS.join('px and ')}px.`)
})()
