# The chapter

Where you are right now, and why it matters. The mentor keeps this current.

## Now

Building the board out into a training and recovery system. The direction is
Ruben's, given 2026-07-30: recovery, exercise, a daily check in, body weight,
and a gamified progress layer on top.

Three goals, all live in `lib/tiles/weights.ts`. He was asked to pick one and
said all three, which the equation supports on purpose: a tile is worth
different amounts to each, so a hard session serving "stronger" while costing
"feel good" is visible instead of hidden.

## The tile roadmap

Order matters here. Each one is a separate build, one at a time.

1. **Check in** - DONE, 2026-07-30. Five 0-10 scales, water, supplements, a
   note. Reports `checkin_score`. Manual, daily, thirty seconds. Built first
   because it needs nothing else to exist and it starts filling the ledger
   immediately.
2. **Lifting** - DONE, 2026-07-30. Sets, reps, weight, RPE. Reports
   `lifting_volume` in kg. PRs and progression fall out of the history rather
   than being tracked separately.
   Two things to not undo: weight is stored in kg ALWAYS and the unit toggle
   is display only, because a history that changes meaning when a preference
   flips is worthless. And a PR is the heaviest set actually performed; the
   Epley figure beside it is labelled an estimate and never stands in for it.
3. **Body** - next. One number, one trend line. Small, deliberately placed
   between two heavy builds.
4. **Recovery** - see the constraint below. Wearable numbers only; the
   subjective half already lives in Check in.
5. **Progress and XP** - last, because it reads from everything above.
   Weight zero in every goal: it is a lens on the other tiles, not its own
   input, and weighting it would count the same work twice.

Deferred by Ruben, not forgotten: full nutrition, cognitive analytics beyond
mood and focus, finances.

## The constraint that shapes all of this

A sealed tile never fetches and never holds a key. So HRV, resting heart rate,
respiratory rate and sleep CANNOT flow in from a wearable by themselves. Two
honest paths, and no third:

- typed in each morning off the watch app, which works today
- an automation holding the API key, writing JSON into this repo, which the
  host fetches and hands to the tile as a feed. A real separate build.

Do not promise a tile that syncs a wearable on its own. It cannot.

## Editorial decisions made against the original plan

- Ruben's "Recovery" and "Daily Check in" lists were the same five subjective
  measures written twice. Merged into Check in. Two tiles logging one truth
  would double count in the ledger and disagree with each other.
- Hydration stays out of the ledger. A tile reports one honest number and for
  Check in that is the score. If water needs to be queryable across tiles it
  wants its own tile with kind 'intake'.
- A readiness score is fine to compute, and Check in already does a version of
  it, but it always shows its inputs and stays mint and amber. Never red, and
  never phrased as a medical judgement. See the design law in CLAUDE.md.
