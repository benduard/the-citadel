/**
 * THE VISUAL CHECK. Loads the real board in a real Chromium and looks at
 * what actually painted - the one class of bug node-based tests structurally
 * cannot catch, because they check the code that PRODUCES a page, never the
 * page itself.
 *
 * This is not paranoia. The first time this ran (2026-07-31) it found a real
 * bug live on the board: every tile's poster was rendering at opacity:0,
 * invisible, some of the time - see vault/decisions.md. Every node suite in
 * this repo was green while that was true.
 *
 * SETUP (once):
 *   cd tools && npm install && npm run install-browser
 *
 * RUN (board must already be serving on :3000 - `npx serve .` from the repo root):
 *   cd tools && npm run check
 *
 * Not part of run-tests.sh's default run: it needs a browser binary on disk
 * and the board actually running, neither of which the plain-node suites
 * require. run-tests.sh calls this LAST and skips it with a one-line hint if
 * tools/node_modules is missing, rather than failing the whole suite over an
 * optional dependency.
 */
const { chromium } = require('playwright')

const BOARD_URL = process.env.BOARD_URL || 'http://localhost:3000/'
const RUNS = Number(process.env.VISUAL_CHECK_RUNS || 5)

// Every registered tile and the selector its poster actually uses. Two
// different id/class conventions exist across tiles (most use #posterView,
// Lifting uses .posterView only) - hardcoding both here is what caught the
// Lifting gap the first time around; keep this in sync with
// lib/tiles/registry.js if a tile is added, renamed, or its poster markup
// changes.
const TILES = [
  { name: 'lists',    sel: '#posterView' },
  { name: 'checkin',  sel: '#posterView' },
  { name: 'body',     sel: '#posterView' },
  { name: 'recovery', sel: '#posterView' },
  { name: 'lifting',  sel: '.posterView' },
  { name: 'progress', sel: '#posterView' },
  { name: 'notes',    sel: '#posterView' },
]

async function oneRun(browser) {
  const page = await browser.newPage({ viewport: { width: 430, height: 900 } })
  const errors = []
  page.on('pageerror', e => errors.push('page: ' + e))
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()) })

  await page.goto(BOARD_URL, { waitUntil: 'networkidle', timeout: 15000 })
  // Real load time for six sealed iframes to boot, not a guess: shorter than
  // this reliably reproduced the stuck-invisible bug during diagnosis.
  await page.waitForTimeout(2500)

  const result = { stuck: [], errors }
  for (const t of TILES) {
    const frame = page.frames().find(f => f.url().includes('/' + t.name))
    if (!frame) { result.stuck.push(t.name + ' (frame never appeared)'); continue }
    const op = await frame.locator(t.sel).evaluate(e => getComputedStyle(e).opacity).catch(() => null)
    if (op !== '1') result.stuck.push(`${t.name} (opacity=${op})`)
  }
  await page.close()
  return result
}

;(async () => {
  console.log(`Checking ${BOARD_URL} across ${RUNS} fresh loads...\n`)
  const browser = await chromium.launch()
  let anyStuck = false, anyErrors = false

  for (let i = 1; i <= RUNS; i++) {
    const r = await oneRun(browser)
    if (r.stuck.length) { anyStuck = true; console.log(`run ${i}: STUCK -> ${r.stuck.join(', ')}`) }
    if (r.errors.length) { anyErrors = true; console.log(`run ${i}: console/page errors -> ${r.errors.join(' | ')}`) }
    if (!r.stuck.length && !r.errors.length) console.log(`run ${i}: clean`)
  }

  await browser.close()
  console.log(anyStuck || anyErrors ? '\nFAILED - see above.' : '\nAll clear. Every tile painted on every run.')
  process.exit(anyStuck || anyErrors ? 1 : 0)
})()
