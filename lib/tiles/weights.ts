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
      checkin: 35,  // how you actually felt, in your own words
      recovery: 30,
      lifting: 20,  // training serves the feeling here, not the reverse
      projects: 10, // finishing things you meant to finish
      body: 5
    }
  },
  {
    id: 'showup',
    label: 'Show up every day, no matter what.',
    weights: {
      checkin: 40,  // the log IS the showing up
      lifting: 25,
      projects: 20,
      recovery: 15
    }
  }
]
