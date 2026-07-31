/**
 * THE RANK - one standing across every log on the board.
 *
 * Bronze to World Class, computed from the LEDGER and nothing else. This is
 * the game layer (gold and petrol, see CLAUDE.md's design law), never a
 * verdict on Ruben as a person. It ranks the HABIT, not the man.
 *
 * ── THE THREE RULES THIS FILE OBEYS ──────────────────────────────────────
 *
 * 1. IT NEVER INVENTS A NUMBER. Every input is a real ledger row someone
 *    actually logged. No population norms, no "8 hours of sleep is an A".
 *    Where there is not enough history, it REFUSES to rank and says how much
 *    more is needed - the same promise Recovery's readiness band makes.
 *
 * 2. IT SCORES YOU AGAINST YOURSELF. "How am I improving" was the ask, so
 *    every trend compares your last 14 days to your previous 14 days. Nobody
 *    else's baseline is anywhere in this file. Holding steady scores the
 *    middle, not zero - maintenance is not failure.
 *
 * 3. IT PRINTS ITS OWN SCALE. Every threshold and target below is an
 *    editorial choice somebody made, not a measurement, so the UI shows them
 *    and this file keeps them in one editable block. Same law the Lifting
 *    ladder follows (vault/decisions.md).
 *
 * ── WHY THESE WEIGHTS ────────────────────────────────────────────────────
 *
 * They are not invented either. lib/tiles/weights.ts already holds Ruben's
 * three goals, and he was asked to pick one and said all three. So all three
 * count equally, and each tile's weight here is the AVERAGE of what he
 * already said that tile was worth across those three goals:
 *
 *   checkin   (20 + 35 + 40) / 3 = 31.7  ->  32
 *   lifting   (40 + 20 + 25) / 3 = 28.3  ->  28
 *   recovery  (30 + 30 + 15) / 3 = 25.0  ->  25
 *   projects  ( 0 + 10 + 20) / 3 = 10.0  ->  10
 *   body      (10 +  5 +  0) / 3 =  5.0  ->   5
 *                                          ------
 *                                            100
 *
 * Change weights.ts and these should be recomputed to match. There is no
 * build step that does it for you.
 *
 * `quests_done` (the Progress tile) is deliberately absent, for the same
 * reason it has weight zero in every goal: XP and streaks are computed FROM
 * the other tiles, so ranking them too would count the same workout twice.
 */
;(function (root, factory) {
  var api = factory()
  if (typeof module === 'object' && module.exports) module.exports = api
  else root.VitalityRank = api
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict'

  // ── THE SCALE. Every number below is a choice, not a measurement. ────────

  /**
   * Days in each comparison window. 14 and 14: long enough that one bad night
   * or one missed session does not swing a rank, short enough that a real
   * change shows up inside a fortnight.
   */
  var WINDOW = 14

  /**
   * How often each log is MEANT to happen, per week. This is the part most
   * worth arguing with - change it here if it does not match how Ruben
   * actually trains.
   *
   * checkin and recovery are 7 because both tiles state daily intent in their
   * own files ("thirty seconds a day", typed in each morning). lifting is 4
   * because "get stronger WITHOUT BREAKING DOWN" is his actual goal and a
   * cadence of 7 would score rest days as failure. body is 3 because a daily
   * weigh-in is water and food and time of day, which is the exact reason the
   * Body tile refuses to draw a trend under 4 readings a week.
   */
  var CADENCE_PER_WEEK = {
    checkin: 7,
    recovery: 7,
    lifting: 4,
    body: 3,
    projects: 0 // not a cadence log - see mode 'cumulative' below
  }

  /**
   * What each tile is worth. Derived from weights.ts - see the header.
   */
  var WEIGHTS = {
    checkin: 32,
    lifting: 28,
    recovery: 25,
    projects: 10,
    body: 5
  }

  /**
   * Rhythm vs trend, inside one tile's score. An even split, because the ask
   * was a rank that reads improvement and the honest half of improvement is
   * still turning up. It also makes the whole scale explainable in a sentence:
   * half of your standing is showing up, half is getting better.
   *
   * What that split implies, and it is worth knowing before arguing with the
   * ladder below: a flat fortnight scores the MIDDLE of the trend half, not
   * zero. Holding steady is not failing.
   *
   *   perfect cadence, improving   -> 100
   *   perfect cadence, flat        ->  75
   *   perfect cadence, declining   ->  50
   */
  var SPLIT = { rhythm: 0.5, trend: 0.5 }

  /**
   * The change that earns a full trend score. A sustained 25% improvement in
   * a fortnight is a lot; capping here is what stops one freak session (or
   * one twelve-hour sleep) from buying a rank.
   */
  var TREND_CAP = 0.25

  /**
   * How many readings a window needs before its side of a comparison counts.
   *
   * Without this, one reading against one reading is enough to move a rank: a
   * single bad night's sleep two weeks ago becomes "the baseline", and this
   * fortnight's single good one reads as a 20% improvement. That is noise
   * wearing a trend's clothes, and it is exactly the failure the Recovery
   * tile already refuses to make.
   *
   * An average needs more support than a total does: 'daily-sum' is total
   * work across a window, where two sessions really are twice one, while a
   * mean of two ratings is barely a mean at all.
   */
  var MIN_READINGS = { 'daily-mean': 3, 'daily-sum': 2 }

  /**
   * The ladder. Bronze to World Class, 0-100 points.
   *
   * Named apart from the Lifting tile's ladder (Wood/Stone/Bronze/.../Olympian)
   * ON PURPOSE - that one ranks what he lifts, this one ranks how he lives.
   * Two ladders with one set of names would be read as one thing.
   */
  /**
   * Anchored to the three outcomes in SPLIT above, so the tiers mean something
   * you can state out loud rather than being seven arbitrary numbers:
   *
   *   Gold      is where a perfect month of showing up lands while every
   *             number is sliding. Turning up through a bad patch is worth
   *             the middle of the ladder, not the bottom of it.
   *   Platinum  is where a perfect month lands with the numbers flat.
   *   Diamond+  cannot be reached on consistency alone. It has to be earned
   *             by actually improving, which is what was asked for.
   */
  var LADDER = [
    { id: 'bronze',      name: 'Bronze',      min: 0,  blurb: 'The board is on. Now it needs days.' },
    { id: 'silver',      name: 'Silver',      min: 30, blurb: 'Logging is becoming a habit.' },
    { id: 'gold',        name: 'Gold',        min: 50, blurb: 'Showing up, even where the numbers are hard.' },
    { id: 'platinum',    name: 'Platinum',    min: 66, blurb: 'The cadence is there. Holding steady.' },
    { id: 'diamond',     name: 'Diamond',     min: 78, blurb: 'Logged and climbing. This one has to be earned.' },
    { id: 'elite',       name: 'Elite',       min: 88, blurb: 'Very few months look like this.' },
    { id: 'world-class', name: 'World Class', min: 95, blurb: 'Full cadence, still improving. This is the ceiling.' }
  ]

  /**
   * How each tile's number behaves, which decides how a trend is even read:
   *
   *   daily-mean  one reading per day, and the average is the point.
   *               A 7.8 mood average vs 7.1 last fortnight is real movement.
   *   daily-sum   per-session work that ADDS UP. Total volume across the
   *               window, so training more often and training heavier both
   *               show, which is what "stronger" means.
   *   cumulative  a running total that only ever goes up (projects done to
   *               date). Comparing the raw number would score "improving"
   *               forever, so what is compared is how much it MOVED in each
   *               window - work finished, not work ever finished.
   *   rhythm-only no honest direction exists, so it is never scored as
   *               better or worse. Only whether it was logged.
   */
  var TILES = [
    { id: 'checkin',  key: 'checkin_score',   label: 'Check in',  mode: 'daily-mean', unit: '/10' },
    { id: 'lifting',  key: 'lifting_volume',  label: 'Lifting',   mode: 'daily-sum',  unit: 'kg' },
    { id: 'recovery', key: 'sleep_hours',     label: 'Recovery',  mode: 'daily-mean', unit: 'h' },
    { id: 'projects', key: 'projects_done',   label: 'Projects',  mode: 'cumulative', unit: '' },
    // body_weight reports goalDirection 'neutral' because whether it should
    // rise or fall is a fact about intent that nobody has stated. Scoring a
    // direction here would be inventing his goal for him.
    { id: 'body',     key: 'body_weight',     label: 'Body',      mode: 'rhythm-only', unit: 'kg' }
  ]

  // ── Plumbing. ────────────────────────────────────────────────────────────

  function clamp(n, lo, hi) { return n < lo ? lo : n > hi ? hi : n }

  function toDayNumber(iso) {
    // Parsed as UTC midnight deliberately: ledger dates are plain YYYY-MM-DD
    // with no timezone, and letting the local zone shift them moves a log
    // across a day boundary for anyone east or west of UTC.
    var parts = String(iso).split('-')
    return Date.UTC(+parts[0], +parts[1] - 1, +parts[2]) / 86400000
  }

  function todayNumber(now) {
    var d = now || new Date()
    return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000
  }

  /**
   * Split one tile's rows into the two windows being compared, plus the
   * window before them (which only the cumulative mode needs, to know how
   * much a running total moved during the PRIOR fortnight).
   */
  function bucket(rows, key, today) {
    var out = { recent: [], prior: [], before: [] }
    rows.forEach(function (r) {
      if (!r || r.key !== key) return
      var v = Number(r.value)
      if (!isFinite(v)) return
      var age = today - toDayNumber(r.date)
      if (age < 0) return                       // a row dated tomorrow is not evidence
      var slot = age < WINDOW ? 'recent' : age < WINDOW * 2 ? 'prior' : age < WINDOW * 3 ? 'before' : null
      if (slot) out[slot].push({ day: age, value: v })
    })
    return out
  }

  function sum(list) { return list.reduce(function (a, b) { return a + b.value }, 0) }
  function mean(list) { return list.length ? sum(list) / list.length : null }
  function peak(list) {
    // Highest value in the window. For a running total that is its value at
    // the end of the window, and it survives a tile re-reporting an older day.
    return list.length ? list.reduce(function (a, b) { return b.value > a ? b.value : a }, -Infinity) : null
  }
  function distinctDays(list) {
    var seen = {}
    list.forEach(function (r) { seen[r.day] = true })
    return Object.keys(seen).length
  }

  /**
   * Flat scores the middle. Improving climbs, sliding falls, and both are
   * capped so one outlier cannot buy or burn a rank.
   *
   * Returns null when there is nothing honest to compare against - a missing
   * trend is reported as missing, never quietly scored as zero, because zero
   * would read as "you got worse" when the truth is "we do not know yet".
   */
  function trendScore(recent, prior) {
    if (recent == null || prior == null) return null
    if (prior === 0) return recent > 0 ? 1 : null // from nothing to something is the top of the band
    var change = (recent - prior) / Math.abs(prior)
    return clamp(0.5 + (clamp(change, -TREND_CAP, TREND_CAP) / TREND_CAP) * 0.5, 0, 1)
  }

  function scoreTile(spec, rows, today) {
    var b = bucket(rows, spec.key, today)
    var weight = WEIGHTS[spec.id] || 0
    var expected = Math.round((CADENCE_PER_WEEK[spec.id] || 0) * (WINDOW / 7))

    /**
     * NEVER USED is not the same as STOPPED, and conflating them was a real
     * bug: a tile Ruben has never once opened was scoring a flat zero and
     * quietly holding his whole rank down, as though not starting something
     * were the same as failing at it.
     *
     *   no rows anywhere ever -> excluded from the rank entirely (below).
     *   rows in history, none lately -> rhythm 0. That IS the honest signal:
     *                                   he used to log this and stopped, and
     *                                   a rank that hid that would be lying.
     */
    var everLogged = rows.some(function (r) { return r && r.key === spec.key })
    if (!everLogged) {
      return {
        id: spec.id, label: spec.label, key: spec.key, unit: spec.unit, mode: spec.mode,
        weight: weight, expected: expected, logged: 0,
        rhythm: null, trend: null, score: null, detail: null,
        hasTrend: false, everLogged: false
      }
    }

    var loggedRecent = distinctDays(b.recent)
    var rhythm = expected > 0 ? clamp(loggedRecent / expected, 0, 1) : null

    var trend = null
    var detail = null

    // Both sides need enough readings to be worth comparing. Too thin and the
    // numbers are still shown - they are real - but no trend is claimed from
    // them, and the tile falls back to being scored on rhythm alone.
    var need = MIN_READINGS[spec.mode] || 1
    var enough = b.recent.length >= need && b.prior.length >= need

    if (spec.mode === 'daily-mean') {
      var mr = mean(b.recent), mp = mean(b.prior)
      trend = enough ? trendScore(mr, mp) : null
      detail = { recent: mr, prior: mp, thin: !enough }
    } else if (spec.mode === 'daily-sum') {
      var sr = b.recent.length ? sum(b.recent) : null
      var sp = b.prior.length ? sum(b.prior) : null
      trend = enough ? trendScore(sr, sp) : null
      detail = { recent: sr, prior: sp, thin: !enough }
    } else if (spec.mode === 'cumulative') {
      // How much the running total MOVED in each window. Needs the window
      // before last to know what the prior fortnight actually delivered.
      var endRecent = peak(b.recent), endPrior = peak(b.prior), endBefore = peak(b.before)
      var didRecent = (endRecent != null && endPrior != null) ? endRecent - endPrior : null
      var didPrior = (endPrior != null && endBefore != null) ? endPrior - endBefore : null
      trend = trendScore(didRecent, didPrior)
      detail = { recent: didRecent, prior: didPrior }
      // Finishing things is not on a weekly clock, so its rhythm IS its
      // output: did the total move at all in the last fortnight.
      rhythm = didRecent == null ? null : (didRecent > 0 ? 1 : 0)
    }

    // rhythm-only tiles (body) never get a trend: no stated direction means
    // no honest better-or-worse, only "you logged it".
    if (spec.mode === 'rhythm-only') trend = null

    // A tile with no trend yet is scored on rhythm alone rather than being
    // dragged down by an unknown. It says so on screen.
    var score =
      rhythm == null && trend == null ? null
      : trend == null ? rhythm
      : rhythm == null ? trend
      : SPLIT.rhythm * rhythm + SPLIT.trend * trend

    return {
      id: spec.id, label: spec.label, key: spec.key, unit: spec.unit, mode: spec.mode,
      weight: weight, expected: expected, logged: loggedRecent,
      rhythm: rhythm, trend: trend, score: score,
      detail: detail,
      hasTrend: trend != null, everLogged: true
    }
  }

  function tierFor(points) {
    var tier = LADDER[0]
    for (var i = 0; i < LADDER.length; i++) if (points >= LADDER[i].min) tier = LADDER[i]
    var next = LADDER[LADDER.indexOf(tier) + 1] || null
    return {
      tier: tier,
      next: next,
      toNext: next ? Math.max(0, next.min - points) : 0,
      // How far through the current band, so a bar can move every day rather
      // than sitting still until a tier flips.
      progress: next ? clamp((points - tier.min) / (next.min - tier.min), 0, 1) : 1
    }
  }

  /**
   * THE ENTRY POINT. Ledger rows in, standing out.
   *
   * Returns { ready:false, ... } while there is not enough history to compare
   * two fortnights. That is not a failure state and must never be rendered as
   * one - it is a countdown, and it says exactly how many days are left.
   */
  function compute(rows, now) {
    rows = Array.isArray(rows) ? rows : []
    var today = todayNumber(now)

    var dated = rows.filter(function (r) {
      return r && typeof r.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.date) && isFinite(Number(r.value))
    })

    if (!dated.length) {
      return { ready: false, reason: 'empty', daysLogged: 0, daysNeeded: WINDOW * 2, parts: [], ladder: LADDER, window: WINDOW }
    }

    var oldest = dated.reduce(function (a, r) {
      var d = toDayNumber(r.date)
      return d < a ? d : a
    }, Infinity)
    var span = today - oldest + 1

    var parts = TILES.map(function (spec) { return scoreTile(spec, dated, today) })

    // Two full windows or it does not rank. Ranking one fortnight against
    // nothing would be a number with no comparison inside it.
    if (span < WINDOW * 2) {
      return {
        ready: false, reason: 'building',
        daysLogged: span, daysNeeded: WINDOW * 2, daysToGo: Math.max(0, WINDOW * 2 - span),
        parts: parts, ladder: LADDER, window: WINDOW
      }
    }

    // Weights are re-normalised over the tiles that actually have something
    // to say. Otherwise a tile he has never opened would silently hold the
    // score down as if he were failing at it.
    var live = parts.filter(function (p) { return p.score != null })
    var totalWeight = live.reduce(function (a, p) { return a + p.weight }, 0)
    if (!totalWeight) {
      return { ready: false, reason: 'empty', daysLogged: span, daysNeeded: WINDOW * 2, parts: parts, ladder: LADDER, window: WINDOW }
    }

    var points = Math.round(live.reduce(function (a, p) { return a + p.weight * p.score }, 0) / totalWeight * 100)
    var standing = tierFor(points)

    return {
      ready: true,
      points: points,
      tier: standing.tier,
      next: standing.next,
      toNext: standing.toNext,
      progress: standing.progress,
      parts: parts,
      counted: live.length,
      daysLogged: span,
      ladder: LADDER,
      window: WINDOW,
      weights: WEIGHTS,
      cadence: CADENCE_PER_WEEK
    }
  }

  return {
    compute: compute,
    tierFor: tierFor,
    LADDER: LADDER,
    WEIGHTS: WEIGHTS,
    CADENCE_PER_WEEK: CADENCE_PER_WEEK,
    WINDOW: WINDOW,
    TILES: TILES
  }
})
