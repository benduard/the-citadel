/**
 * The equation. y = Sum of w times x.
 *
 * Your goal is y. Every tile is an x. The weight is what that tile is worth
 * toward that goal. Each goal's weights add up to 100.
 *
 * Plain data. No AI key. Versioned in git, so it travels with you.
 * The mentor writes this with you. Empty until then, on purpose.
 */

export interface Goal {
  id: string
  /** One sharp sentence. This is y. */
  label: string
  /** tile slot -> what it is worth toward this goal. Adds up to 100. */
  weights: Record<string, number>
}

/** Your main goal, polished into one sentence with the mentor. */
export const OVERALL_GOAL =
  'Get stronger without breaking down, feel good doing it, and show up every day.'

/**
 * Your goals. You can have more than one.
 *
 * Three, because you said all three. They are not the same goal wearing
 * different hats: the same tile is worth different amounts to each, and that
 * is the point. A hard session serves strength and costs you on feel-good.
 * Seeing both move is how you notice a trade you did not mean to make.
 *
 * `progress` is deliberately absent from every list. XP, levels and streaks
 * are computed FROM the tiles below, so giving it weight would count the same
 * workout twice. It exists for the feeling, not the arithmetic.
 *
 * `notes` is absent for a different reason: it reports nothing at all. A tile
 * reports one honest number or none, and there is no honest number in a note.
 * A count of them is not progress toward getting stronger, feeling good or
 * showing up - it would be a row in the ledger that means nothing, and a
 * weight here would be the thing that pretended it did. Notes is a place to
 * write, and its worth is that the writing is kept.
 *
 * `reminders` is absent for that same reason, and it is worth being precise
 * about which reason, because this one is tempting. It would be easy to report
 * how many reminders fired and call it showing up. It is not: a notification
 * arriving is the phone doing something, not him. Whether he actually took the
 * creatine is a fact this tile has no way of knowing, and inventing a number
 * out of a delivery receipt is exactly the made-up number the house rules
 * forbid. What he did lands in the ledger from the tile where he did it.
 * Reminders is a nudge, and its worth is that the nudge arrives.
 */
export const DEFAULT_GOALS: Goal[] = [
  {
    id: 'strong',
    label: 'Get stronger without breaking down.',
    weights: {
      lifting: 40,  // the work itself
      recovery: 30, // what protects the work
      checkin: 20,  // the early warning that something is off
      body: 10
    }
  },
  {
    id: 'feel',
    label: 'Feel good every day, consistently.',
    weights: {
      checkin: 32,  // how you actually felt, in your own words
      recovery: 27,
      lifting: 18,  // training serves the feeling here, not the reverse
      screentime: 10,
      projects: 9,  // finishing things you meant to finish
      body: 4
    }
  },
  {
    id: 'showup',
    label: 'Show up every day, no matter what.',
    weights: {
      checkin: 36,  // the log IS the showing up
      lifting: 22,
      projects: 18,
      recovery: 14,
      screentime: 10
    }
  }
]

/**
 * SCREEN TIME, added 2026-09-07, and the reasoning kept here so it is not
 * re-argued from scratch in six months.
 *
 * It takes 10 from `feel` and 10 from `showup`, and NOTHING from `strong`.
 * That last part is the point: hours on a phone do not move a squat, and a
 * weight in `strong` would be this file claiming a relationship the data
 * cannot support. An honest zero is a real answer.
 *
 * The 10 came off the other tiles PROPORTIONALLY rather than out of one of
 * them, so the balance between checkin, recovery, lifting and the rest is
 * exactly what it was - the whole set just makes room. Both goals still sum
 * to 100, which is the one invariant this file has.
 *
 * It is worth a weight at all because it is the only tile here that measures
 * where the day actually went, rather than what was done on purpose. It
 * reports 'screen_minutes' with goalDirection 'down', so the direction is
 * recorded intent - stated when it was added - and not a health claim.
 */
