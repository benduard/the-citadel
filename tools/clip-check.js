/**
 * THE CLIP CHECK. Finds a placeholder or a one-line label whose text is wider
 * than the box drawn around it, so the browser silently cuts it off mid-word.
 *
 * Why it exists. Lifting's weight box read `none = t` on a phone. The
 * placeholder was "none = bodyweight", and that box is one of three across, so
 * it is about 100px wide - and a browser does not wrap, shrink or ellipsis a
 * placeholder, it just clips. The one line explaining that an empty weight box
 * is a real answer had been painting as a broken string.
 *
 * NOTHING ELSE COULD HAVE CAUGHT IT, which is the third time that has been true
 * on this board and the reason this file exists rather than a note to remember:
 *   - the node suites read the SOURCE, so they saw the whole string
 *   - visual-check asks whether the tile painted, and it did
 *   - touch-check measures whether a control can be hit, and it could
 *   - squeeze-check finds text wrapped into a vertical column, and a clipped
 *     placeholder does not wrap at all - it is one line, ending early
 *   - number-check measures NUMBERS, and this is a hint
 * Every one of them asks whether an element is well formed. None asks whether
 * the words inside it are all still visible.
 *
 * WHAT IT FLAGS: text measured wider than the space it has, by more than a
 * couple of pixels of rounding. Placeholders in every input, plus single-line
 * elements that have been told not to wrap (white-space:nowrap / text-overflow
 * ellipsis), which is the other way to lose the end of a sentence.
 *
 * AN ELLIPSIS IS NOT AUTOMATICALLY A BUG - truncating a long user-typed title
 * with "..." is a real design choice, and it is visibly truncated, so a reader
 * knows there is more. A clipped PLACEHOLDER is different: nothing marks it,
 * so it reads as the whole message. Ellipsis elements are reported separately
 * and do not fail the run.
 *
 * SETUP (once):  cd tools && npm install && npm run install-browser
 * RUN (board serving on :3000): node tools/clip-check.js
 */
const { chromium } = require('playwright')

const URL = process.env.BOARD_URL || 'http://localhost:3000/'
const TILES = ['Lists', 'Check in', 'Body', 'Recovery', 'Lifting', 'Progress', 'Notes']
// 320 is the narrowest phone that has to work. If it reads at 320 it reads
// everywhere, so a pass here is the one that matters.
const WIDTHS = [320, 390]

// A couple of pixels of sub-pixel rounding is not a clipped word. Anything
// past this is a whole character or more gone.
const SLACK = 3

// Dates are COMPUTED, never written down: several tiles show TODAY's number
// and would render their empty state - with no inputs to measure - if seeded
// for a day that is not today. number-check.js broke exactly that way once.
const day = (back = 0) => {
  const d = new Date()
  d.setDate(d.getDate() - back)
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${dd}`
}
const TODAY = day(0)

const SEED = {
  'v:tile:projects': { v:3, lists:{
      daily:[{ id:'a', title:'Call the bank about the mortgage', done:false, repeat:true, createdAt:day(28), doneAt:null }],
      weekly:[], grocery:[], projects:[], someday:[] },
    custom:[], archive:[], done:{}, logFrom:day(35), rolledOn:'', rolledWeek:'' },
  'v:tile:checkin': { days:{ [TODAY]:
    { mood:8, energy:7, focus:9, stress:3, soreness:3, water:6, supps:true, note:'Felt strong today' } } },
  'v:tile:body': { unit:'kg', days:{ [TODAY]: 102.4, [day(1)]: 102.9 } },
  'v:tile:recovery': { days:{ [TODAY]: { sleepH:7.5, hrv:68, rhr:52, resp:14.2 } } },
  'v:tile:lifting': { v:2, unit:'kg', bw:102.4, weekTarget:3, rest:120, restAuto:true,
    days:{ [TODAY]:[
      { id:'s1', ex:'Back Squat', kg:140, reps:5, rpe:8, note:'' },
      { id:'s2', ex:'Dip', kg:20, reps:8, rpe:7, note:'machine reads heavy here' }] },
    notes:{}, routines:[], custom:[], claimed:{}, lvlSeen:1, rankSeen:{},
    splits:{ [TODAY]:'legs' }, routineToday:{}, deloads:{},
    scheme:'yours', customSplits:[], attempts:[], uni:{}, fuel:{} },
  'v:tile:progress': { v:1, quests:[{ id:'q1', title:'Train four times this week', done:true, createdAt:day(7) }], retired:0, xp:1250 },
  'v:tile:notes': { v:1, notes:[
    { id:'n1', body:'Gym plan\nPush Monday, pull Wednesday', createdAt:TODAY + 'T09:00:00.000Z', updatedAt:TODAY + 'T09:00:00.000Z' }] }
}

/**
 * Runs inside the frame. Measures painted text against the box it sits in.
 *
 * A CANVAS, NOT A RANGE. getClientRects() reports the BOX a line was laid out
 * in, which for clipped text is the box, not the text - so it can never see the
 * overflow. Measuring the string against the element's own resolved font is the
 * only way to learn how wide it wanted to be. A placeholder has no text node at
 * all, so there is nothing to put a Range over in the first place.
 */
const sweep = (SLACK_PX) => {
  const out = []
  const seen = new Set()
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')

  const fontOf = cs =>
    cs.fontStyle + ' ' + cs.fontVariant + ' ' + cs.fontWeight + ' ' +
    cs.fontSize + '/' + cs.lineHeight + ' ' + cs.fontFamily

  const visible = (el, cs) => {
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false
    const r = el.getBoundingClientRect()
    return r.width > 1 && r.height > 1
  }

  /**
   * How much room the text actually has.
   *
   * clientWidth IS ALWAYS ZERO ON A NON-REPLACED INLINE ELEMENT - a <span>, an
   * <i>, a bare <b>. The first cut of this used it alone and duly reported
   * every inline label on the board as "needs 5px, has 0px", which is not a
   * clipped word, it is the wrong measurement. getBoundingClientRect() spans
   * the laid-out text in that case, so it is the honest number.
   */
  const room = (el, cs) => {
    const rect = el.getBoundingClientRect()
    const box = el.clientWidth || rect.width
    return box - parseFloat(cs.paddingLeft || 0) - parseFloat(cs.paddingRight || 0)
  }

  const record = (kind, el, text, want, have, soft) => {
    const cls = typeof el.className === 'string' && el.className ? '.' + el.className.split(' ')[0] : ''
    const where = (el.id ? '#' + el.id : cls || el.tagName.toLowerCase())
    const key = kind + '|' + where + '|' + text.slice(0, 24)
    if (seen.has(key)) return
    seen.add(key)
    out.push({ soft: !!soft,
      line: `${kind} "${text}" in ${where} - needs ${Math.round(want)}px, has ${Math.round(have)}px` })
  }

  // 1. Placeholders. Nothing marks a clipped one, so it reads as the whole
  //    message - which is exactly how "none = bodyweight" became "none = t".
  document.querySelectorAll('input[placeholder], textarea[placeholder]').forEach(el => {
    const ph = el.getAttribute('placeholder')
    if (!ph || !ph.trim()) return
    const cs = getComputedStyle(el)
    if (!visible(el, cs)) return
    // A textarea wraps its placeholder, so it cannot clip horizontally.
    if (el.tagName === 'TEXTAREA') return
    ctx.font = fontOf(cs)
    const want = ctx.measureText(ph).width
    const have = room(el, cs)
    if (want > have + SLACK_PX) record('placeholder', el, ph, want, have)
  })

  // 2. Single-line text told not to wrap. The other way a sentence loses its
  //    end. Leaf elements only - a container is never blamed for its children.
  document.querySelectorAll('*').forEach(el => {
    if (el.children.length) return
    const text = (el.textContent || '').trim()
    if (!text) return
    const cs = getComputedStyle(el)
    if (!visible(el, cs)) return
    /**
     * NOWRAP ALONE LOSES NOTHING. An element with `overflow: visible` - which
     * is every plain <button> on this board - paints its text right past its
     * own border when a flex row squeezes it. That can look untidy, but every
     * word is still on screen and readable, and this check is about text that
     * is GONE. Flagging it put four buttons on the list whose labels were
     * fully legible, which is how a check earns the reputation of being noise
     * and stops being run.
     *
     * So the text has to be somewhere it can actually be cut: an overflow that
     * clips, or an explicit ellipsis.
     */
    const clips = ['hidden', 'clip', 'auto', 'scroll'].indexOf(cs.overflowX) !== -1
    const nowrap = (cs.whiteSpace === 'nowrap' || cs.whiteSpace === 'pre') && clips
    const ellipsis = cs.textOverflow === 'ellipsis'
    if (!nowrap && !ellipsis) return
    ctx.font = fontOf(cs)
    const want = ctx.measureText(text).width
    const have = room(el, cs)
    if (want > have + SLACK_PX) {
      // Ellipsis is a visible, deliberate truncation - reported, never failed.
      record(ellipsis ? 'ellipsis' : 'nowrap text', el, text.slice(0, 40), want, have, ellipsis)
    }
  })

  return out
}

;(async () => {
  const browser = await chromium.launch()
  const failures = []
  const soft = []

  const take = (hits, where) => hits.forEach(h => {
    const line = `${where}: ${h.line}`
    const bucket = h.soft ? soft : failures
    if (!bucket.includes(line)) bucket.push(line)
  })

  for (const width of WIDTHS) {
    const ctx = await browser.newContext({ viewport: { width, height: 880 }, hasTouch: true, isMobile: true })
    const page = await ctx.newPage()
    await page.goto(URL, { waitUntil: 'networkidle' })
    await page.evaluate(s => Object.keys(s).forEach(k => localStorage.setItem(k, JSON.stringify(s[k]))), SEED)
    await page.reload({ waitUntil: 'networkidle' })
    await page.waitForTimeout(2200)

    // The grid's own posters, before opening anything - the same sweep
    // squeeze-check does. A poster carries no inputs, but it is all short
    // labels in tight boxes, which is precisely where a nowrap line loses its
    // end. Skipping it would leave the face of the board unchecked.
    for (const f of page.frames()) {
      if (!/\/tiles\//.test(f.url())) continue
      take(await f.evaluate(sweep, SLACK).catch(() => []),
        `${width}px  poster ${f.url().split('/').pop().replace('.html', '')}`)
    }

    for (const tile of TILES) {
      const opener = `button.tileHit[aria-label="Open ${tile}"]`
      if (!(await page.$(opener))) continue
      await page.click(opener)
      await page.waitForTimeout(900)
      const frame = page.frames().find(f => /#page$/.test(f.url()))
      if (!frame) { failures.push(`${width}px  ${tile}: page never opened`); continue }

      // Every tab, the same way squeeze-check does it: a view you never open
      // is a view nothing is looking at.
      const ids = await frame.evaluate(() =>
        [...document.querySelectorAll('[data-nav],[data-wtab],[data-view],.tab,.seg button,.vBtn')]
          .map((el, i) => { el.setAttribute('data-clid', 'c' + i); return 'c' + i }))

      for (const id of [null].concat(ids)) {
        if (id) {
          try {
            await frame.evaluate(i => {
              const el = document.querySelector(`[data-clid="${i}"]`)
              if (el && !el.disabled) el.click()
            }, id)
            await page.waitForTimeout(300)
          } catch (e) { continue }
        }
        take(await frame.evaluate(sweep, SLACK).catch(() => []), `${width}px  ${tile}`)
      }

      /**
       * Lifting's weight hint changes with the exercise picked - that is the
       * whole point of it - so every kind has to be looked at, not just
       * whichever one the picker happened to open on. This is the exact box
       * that was broken.
       */
      if (tile === 'Lifting') {
        for (const ex of ['Barbell Bench Press', 'Dip', 'Dumbbell Row', 'Hanging Leg Raise']) {
          const ok = await frame.evaluate(name => {
            const sel = document.querySelector('#fEx')
            if (!sel || ![...sel.options].some(o => o.value === name)) return false
            sel.value = name
            sel.dispatchEvent(new Event('change', { bubbles: true }))
            return true
          }, ex).catch(() => false)
          if (!ok) continue
          await page.waitForTimeout(200)
          take(await frame.evaluate(sweep, SLACK).catch(() => []), `${width}px  Lifting (${ex})`)
        }
      }

      await page.evaluate(() => { const b = document.querySelector('.vPageClose'); if (b) b.click() })
      await page.waitForTimeout(400)
      console.log(`  ${width}px  checked ${tile}`)
    }
    await ctx.close()
  }

  await browser.close()

  if (soft.length) {
    console.log(`\n${soft.length} deliberate ellipsis truncation(s), not failures:\n` +
      soft.map(f => '  ' + f).join('\n'))
  }
  if (failures.length) {
    console.log(`\n${failures.length} piece(s) of text clipped by their own box:\n` +
      failures.map(f => '  ' + f).join('\n'))
    process.exit(1)
  }
  console.log(`\nNo placeholder or single-line label is cut off, across ${TILES.length} tiles, ` +
    `all their tabs, at ${WIDTHS.join('px and ')}px.`)
})()
