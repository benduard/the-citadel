/**
 * THE NUMBER CHECK. Every big number on the board, measured in a real
 * Chromium at real phone widths, looking for the one thing a node test cannot
 * see: a number that does not fit the box it is in.
 *
 * Why this exists. Ruben reported the numbers inside tiles "not being shown
 * too well on mobile". Guessing at that from the CSS is exactly the wrong
 * move - the poster is a sealed iframe inside a grid cell whose width comes
 * from the board's own breakpoints, so the only honest way to find out is to
 * measure the rendered text against the box on the widths he actually uses.
 *
 * What counts as a failure, and why each one:
 *   OVERFLOW  the text is wider than its container. On a poster this is a
 *             number with its end cut off, which is worse than no number.
 *   BELOW     the number's bottom edge is past the card's own fold. It is
 *             rendered, it is just not on screen.
 *   CLIPPED   the document is taller than the iframe's viewport at all.
 *   TINY      under 11px. Not a layout break, but a number nobody can read on
 *             a phone is not being "shown" either.
 *
 * THE NOTCH PASS, and why the first version of this tool missed a real bug.
 * env(safe-area-inset-*) resolves to 0 in a desktop browser, so a poster can
 * look perfect here and be visibly broken on an iPhone home screen where the
 * inset is around 59px. That is exactly what happened: the tiles applied the
 * insets to `body` in BOTH modes, an s-sized card is about 122px tall, and
 * half of it became padding - Ruben reported the check-in score sitting low
 * and cut off, and every desktop check was green. So every width is measured
 * twice, once flat and once with a phone's insets stood in for directly.
 *
 * The first version also COMPUTED the vertical overflow and then never
 * asserted on it, which is its own lesson: a signal you collect and do not
 * check is not a check.
 *
 * SETUP (once):  cd tools && npm install && npm run install-browser
 * RUN (board serving on :3000): node tools/number-check.js
 */
const { chromium } = require('playwright')

const BOARD_URL = process.env.BOARD_URL || 'http://localhost:3000/'

// The narrow end of what a phone actually is. 320 is an iPhone SE in portrait
// and the tightest thing that has to work; 430 is a Pro Max. Anything wider
// has never been the problem.
const WIDTHS = [320, 360, 390, 414, 430]

// Every element on a poster that carries a number or a headline figure.
// Selector per tile, because the tiles do not share a convention.
const TARGETS = [
  { tile: 'lists',    sel: '.pNum, .pOf' },
  { tile: 'checkin',  sel: '.posterHero .num, .posterHero .unit' },
  { tile: 'body',     sel: '.posterHero .num, .posterHero .unit' },
  { tile: 'recovery', sel: '.posterHero .num, .posterHero .unit, .bandName' },
  { tile: 'lifting',  sel: '.pHero, .pUnit' },
  { tile: 'progress', sel: '.posterHero .num, .posterHero .unit' },
  { tile: 'notes',    sel: '.posterHero .num, .posterHero .unit' },
]

const MIN_READABLE = 11

/**
 * A poster with nothing in it renders its empty state and no number at all,
 * so an unseeded board would pass this check by having nothing to fail.
 *
 * These are DELIBERATELY at the wide end of plausible: a four figure volume,
 * a weight with a decimal, a two digit sleep figure. The narrow cases were
 * never going to break - the question this tool answers is what happens when
 * the number is as long as it realistically gets.
 */
const SEED = {
  'v:tile:projects': { v:3, lists:{ daily:[
      { id:'a', title:'Write the thing', done:false, repeat:false, createdAt:'2026-08-01', doneAt:null },
      { id:'b', title:'Call the bank', done:true, repeat:false, createdAt:'2026-08-01', doneAt:'2026-08-04' },
      { id:'c', title:'Stretch', done:false, repeat:true, createdAt:'2026-08-01', doneAt:null }
    ], weekly:[], grocery:[], projects:[], someday:[] },
    custom:[], archive:[], done:{}, logFrom:'2026-08-01', rolledOn:'', rolledWeek:'' },
  // Shapes copied from each tile's own header comment, not guessed. A seed
  // that does not match makes the tile render its EMPTY state, which has no
  // number in it - so the check would pass by having nothing to measure. The
  // per-tile assertion below is what stops that being a silent pass.
  'v:tile:checkin': { days:{ '2026-08-04':
    { mood:8, energy:7, focus:9, stress:3, soreness:3, water:6, supps:true, note:'' } } },
  'v:tile:body': { unit:'kg', days:{ '2026-08-04': 102.4, '2026-08-03': 102.9, '2026-08-02': 103.1 } },
  'v:tile:recovery': { days:{ '2026-08-04': { sleepH:7.5, hrv:68, rhr:52, resp:14.2 } } },
  'v:tile:lifting': { v:2, unit:'kg', bw:102.4, weekTarget:3, rest:120, restAuto:true,
    // Deliberately a big day: this puts five figures on the Lifting poster,
    // which is the longest number the board ever shows.
    days:{ '2026-08-04': [
      { id:'s1', ex:'Back Squat', kg:140, reps:5, rpe:8, note:'' },
      { id:'s2', ex:'Back Squat', kg:140, reps:5, rpe:9, note:'' },
      { id:'s3', ex:'Leg Press', kg:280, reps:10, rpe:8, note:'' },
      { id:'s4', ex:'Leg Press', kg:280, reps:10, rpe:9, note:'' },
      { id:'s5', ex:'Leg Press', kg:280, reps:10, rpe:9, note:'' },
      { id:'s6', ex:'Romanian Deadlift', kg:180, reps:8, rpe:8, note:'' },
      { id:'s7', ex:'Romanian Deadlift', kg:180, reps:8, rpe:8, note:'' }
    ] },
    notes:{}, routines:[], custom:[], claimed:{}, lvlSeen:1, rankSeen:{},
    splits:{}, routineToday:{}, deloads:{}, scheme:'yours', customSplits:[] },
  'v:tile:progress': { v:1, quests:[
      { id:'q1', title:'Train four times', done:true, createdAt:'2026-08-01' },
      { id:'q2', title:'Sleep seven hours', done:false, createdAt:'2026-08-01' }
    ], retired:0, xp:1250 },
  'v:tile:notes': { v:1, notes:[
      { id:'n1', body:'Gym plan\nPush Monday', createdAt:'2026-08-04T09:00:00.000Z', updatedAt:'2026-08-04T09:00:00.000Z' },
      { id:'n2', body:'Groceries\nolive oil', createdAt:'2026-08-03T09:00:00.000Z', updatedAt:'2026-08-03T09:00:00.000Z' }
    ] }
}

/**
 * The iPhone's safe-area inset, applied through the DevTools protocol so the
 * BROWSER resolves env() itself.
 *
 * The first attempt at this faked it by injecting
 * `body{ padding-top:59px !important }`, which is worse than useless: that
 * forces the padding on regardless of what the tile's own CSS says, so it
 * reports a failure whether or not the bug is fixed. A simulation that cannot
 * tell those two apart is not a test.
 *
 * With the override in place, env(safe-area-inset-top) reads 59px INSIDE the
 * sealed iframe - verified directly, and the reason this bug reached his phone
 * at all. 59/34 is a Dynamic Island iPhone in portrait.
 */
const NOTCH = { top: 59, bottom: 34, left: 0, right: 0 }

async function measure(frame, sel) {
  return frame.evaluate(({ s }) => {
    const out = []
    document.querySelectorAll(s).forEach((el) => {
      const r = el.getBoundingClientRect()
      if (!r.width && !r.height) return               // not rendered on this face
      const cs = getComputedStyle(el)
      const box = el.parentElement || el
      const br = box.getBoundingClientRect()
      out.push({
        text: (el.textContent || '').trim().slice(0, 24),
        px: Math.round(parseFloat(cs.fontSize) * 10) / 10,
        // scrollWidth vs clientWidth is the honest overflow test: it is the
        // laid-out text against the box, not a guess from character counts.
        overflowX: el.scrollWidth - el.clientWidth,
        // The one the first version computed and then forgot to assert on.
        overflowY: document.documentElement.scrollHeight - window.innerHeight,
        // How far the number's bottom edge sits past the card's fold. This is
        // the number being off screen, which is what Ruben actually saw.
        below: Math.round(r.bottom - window.innerHeight),
        wider: Math.round(r.width - br.width),
        cls: el.className || el.tagName.toLowerCase()
      })
    })
    return out
  }, { s: sel })
}

;(async () => {
  const browser = await chromium.launch()
  const problems = []
  let checked = 0

  // Flat first, then again with a phone's insets. The second pass is the one
  // that catches what a desktop browser structurally cannot see.
  const PASSES = [
    { notch: false, where: 'flat     ' },
    { notch: true,  where: 'with notch' }
  ]

  for (const width of WIDTHS) {
  for (const { notch, where } of PASSES) {
    const page = await browser.newPage({ viewport: { width, height: 860 } })
    if (notch) {
      const cdp = await page.context().newCDPSession(page)
      await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: NOTCH })
    }
    // Seed before the board's own scripts run, or the tiles boot empty and
    // this check passes by having no number to measure.
    await page.addInitScript((seed) => {
      try {
        Object.keys(seed).forEach((k) => window.localStorage.setItem(k, JSON.stringify(seed[k])))
      } catch (e) { /* first navigation has no origin yet; the retry below lands */ }
    }, SEED)
    await page.goto(BOARD_URL, { waitUntil: 'networkidle', timeout: 20000 })
    await page.evaluate((seed) => {
      Object.keys(seed).forEach((k) => window.localStorage.setItem(k, JSON.stringify(seed[k])))
    }, SEED)
    await page.reload({ waitUntil: 'networkidle', timeout: 20000 })
    await page.waitForTimeout(2500)

      for (const t of TARGETS) {
        const frame = page.frames().find((f) => f.url().includes('/' + t.tile))
        if (!frame) { problems.push(`${width}px ${where}  ${t.tile}  frame never appeared`); continue }
        const rows = await measure(frame, t.sel).catch(() => [])
        /**
         * The check's own blind spot, closed. A tile whose seed does not match
         * its real store shape renders its empty state, which contains no
         * number - and this tool would then report "every number fits" having
         * measured none of them. Two seeds were wrong exactly this way when it
         * was written. If a tile stops producing a number, that is a broken
         * seed or a broken tile, and either way it is a failure, not a pass.
         */
        if (!rows.length) {
          problems.push(`${width}px ${where}  ${t.tile}  NO NUMBER RENDERED - seed shape wrong, or the poster broke`)
          continue
        }
        rows.forEach((r) => {
          checked++
          const at = `${width}px ${where}  ${t.tile}`
          if (r.overflowX > 1) problems.push(`${at}  OVERFLOW by ${r.overflowX}px  "${r.text}" (${r.px}px, .${r.cls})`)
          else if (r.wider > 1) problems.push(`${at}  WIDER THAN ITS BOX by ${r.wider}px  "${r.text}" (${r.px}px, .${r.cls})`)
          if (r.below > 1) problems.push(`${at}  ${r.below}px BELOW THE FOLD  "${r.text}" (.${r.cls})`)
          if (r.overflowY > 1) problems.push(`${at}  CLIPPED, document ${r.overflowY}px taller than the card`)
          if (r.px < MIN_READABLE) problems.push(`${at}  TINY at ${r.px}px  "${r.text}" (.${r.cls})`)
        })
      }

      await page.close()
    }
  }

  await browser.close()

  console.log(`\nChecked ${checked} numbers across ${WIDTHS.length} phone widths and ${TARGETS.length} tiles.\n`)
  if (problems.length) {
    problems.forEach((p) => console.log('  ' + p))
    console.log(`\n${problems.length} problem(s).`)
    process.exit(1)
  }
  console.log('Every number fits its box and is big enough to read.')
})()
