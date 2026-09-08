/**
 * IS THIS REMINDER DUE RIGHT NOW. The only question that matters, kept on its
 * own, in plain JavaScript, so the thing that runs on the server is the exact
 * thing the tests run.
 *
 * WHY IT IS NOT JUST INSIDE index.ts. Deno runs TypeScript and node does not,
 * so a test next to the rest of the suite could only ever re-implement these
 * rules and then assert that the real file still LOOKS like it agrees - which
 * is how two copies of a rule quietly drift apart, one of them correct. As
 * .mjs it is a real module to both: index.ts imports it, tools/reminders.test.js
 * imports it, and there is one implementation to be wrong.
 *
 * EVERYTHING HERE IS PURE. No database, no clock of its own - the time is
 * passed in - and no push. That is what makes "does it fire twice", "does it
 * fire the moment you save it" and "what happens at midnight" answerable at a
 * terminal instead of by waiting until 07:00 with a phone in your hand.
 */

/**
 * HOW LATE IS STILL WORTH SENDING. An hour, matching the rest timer's own
 * staleness window in send-timer-push.
 *
 * It is not fussiness, it is what makes a missed hour cost an hour. Without an
 * upper bound, a reminder the sender could not deliver - a bad deploy, cron
 * paused, the project asleep - would stay due for the rest of the day and land
 * at some meaningless moment that evening. With it, a 07:00 reminder either
 * arrives by 08:00 or does not arrive, and tomorrow is unaffected.
 */
export const GRACE_MIN = 60

const WEEKDAY = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }

/**
 * What time is it, and what day, WHERE HE IS. Intl is the only thing that
 * knows, and it is built into both runtimes.
 *
 * An unknown or misspelled zone makes DateTimeFormat throw, and one bad row
 * must never take down everyone else's reminders - so it falls back to UTC and
 * says so, rather than throwing out of the loop.
 *
 * @param {number} utcMs
 * @param {string} tz
 */
export function localParts(utcMs, tz) {
  const opts = {
    hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', weekday: 'short'
  }
  let parts
  try {
    parts = new Intl.DateTimeFormat('en-CA', { ...opts, timeZone: tz || 'UTC' })
      .formatToParts(new Date(utcMs))
  } catch {
    console.warn('unknown timezone, falling back to UTC:', tz)
    parts = new Intl.DateTimeFormat('en-CA', { ...opts, timeZone: 'UTC' })
      .formatToParts(new Date(utcMs))
  }
  const get = (t) => {
    const p = parts.find((x) => x.type === t)
    return p ? p.value : ''
  }
  // 'en-CA' gives 24 hour time, but midnight comes back as '24' in some
  // engines rather than '00'. Left alone that turns 00:10 into minute 1450,
  // which is past every reminder in the day - the whole list would go off at
  // midnight, every night, on whichever engine did that.
  const hour = Number(get('hour')) % 24
  const wd = WEEKDAY[get('weekday')]
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    minutes: hour * 60 + Number(get('minute')),
    weekday: wd === undefined ? 0 : wd
  }
}

/**
 * Does the rule say anything at all about today?
 * @param {{repeat:string, days?:number[]|null, on_date?:string|null}} r
 * @param {string} localDate 'YYYY-MM-DD' where he is
 * @param {number} weekday 0 = Sunday, matching JavaScript's getDay()
 */
export function ruleMatchesDay(r, localDate, weekday) {
  if (r.repeat === 'daily') return true
  if (r.repeat === 'weekdays') return weekday >= 1 && weekday <= 5
  if (r.repeat === 'weekends') return weekday === 0 || weekday === 6
  if (r.repeat === 'days') return Array.isArray(r.days) && r.days.indexOf(weekday) !== -1
  if (r.repeat === 'once') return String(r.on_date || '').slice(0, 10) === localDate
  // An unknown repeat matches nothing. A rule this server does not understand
  // must never be the one that notifies someone every day forever.
  return false
}

/**
 * The key to stamp this reminder with, or null for not due.
 *
 * @param {object} r the row, as stored
 * @param {number} nowMs
 * @returns {string|null} 'YYYY-MM-DD@HH:MM'
 */
export function dueKey(r, nowMs) {
  if (!r.enabled) return null

  const at = /^(\d{1,2}):(\d{2})$/.exec(String(r.at_time || ''))
  if (!at) return null
  const hh = Number(at[1])
  const mm = Number(at[2])
  if (!(hh >= 0 && hh < 24 && mm >= 0 && mm < 60)) return null
  const atMinutes = hh * 60 + mm

  const { date, minutes, weekday } = localParts(nowMs, r.tz)
  if (!ruleMatchesDay(r, date, weekday)) return null

  // Past its time, but not by more than the grace. Negative means it has not
  // come round yet today.
  const late = minutes - atMinutes
  if (late < 0 || late > GRACE_MIN) return null

  // ALREADY SENT. The key carries the TIME as well as the day, which is what
  // makes moving a reminder work: fire the 07:00 one, change it to 22:00 that
  // afternoon, and 22:00 is an occurrence this rule has not fired rather than
  // a day already crossed off. A plain date would have swallowed it silently.
  const key = `${date}@${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
  if (r.last_fired_key === key) return null

  // THE OCCURRENCE HAS TO BE NEWER THAN THE RULE. Set a reminder at 08:00 for
  // 07:30 and 07:30 today is still inside the grace window - without this it
  // would go off in your hand the second you saved it, which reads as a bug
  // and is certainly not what was asked for. Tomorrow's 07:30 is the first
  // occurrence that belongs to this rule.
  const occurredAt = nowMs - late * 60000
  if (new Date(r.updated_at).getTime() > occurredAt) return null

  return key
}
