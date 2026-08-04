/**
 * THE REGISTRY - the list of tiles on this board.
 *
 * This is move 2 of adding a tile. The file lands in tiles/, then it gets one
 * line here, and the board renders it. That is the whole registration.
 *
 * Each entry:
 *   id    a short stable slug. THIS IS THE STORAGE KEY. Never change it after
 *         data exists under it, or the tile boots empty and its history is
 *         orphaned. Renaming an id is a data migration, not a rename.
 *   name  what a human calls it. Safe to change any time.
 *   file  the path to the tile's html, relative to index.html.
 *   size  how much grid it takes. One of:
 *           s     1 wide, 1 tall
 *           m     2 wide, 1 tall
 *           tall  1 wide, 2 tall
 *           hero  3 wide, 1 tall
 *           big   2 wide, 2 tall
 *           band  4 wide, 1 tall
 *           l     4 wide, 2 tall
 *         (matches lib/tiles/tileSkin.ts SIZE_PRESETS on Vitality)
 *   page  optional, true = the grid shows the tile's poster face and tapping
 *         it opens the same file full screen (the host adds '#page' so the
 *         file knows which layer to render).
 *   data  optional, path to a JSON file in this repo that automation writes
 *         (e.g. 'tiles/data/finance.json'). The host fetches it and hands it
 *         to the tile as a feed. Sealed tiles cannot fetch; this is the pipe.
 *
 * Ships empty on purpose. An empty board is the seed. Every tile from here is
 * theirs, added one at a time.
 */
// Ordered by WHEN you reach for them, not by when they were built.
// Lists is first because it is the one you open before the day starts. Then
// the morning, then training and the game layer on top of it.
//
// On a 4 column grid this packs as:
//   row 1   Lists Lists  Check in  Body
//   row 2   Lists Lists  Recovery Recovery
//   row 3   Lifting Lifting  Progress Progress
window.TILES = [
  // THE ID IS 'projects' ON PURPOSE. It was renamed to Lists on 2026-07-31 and
  // the id did NOT change, because the id is the vault storage key: renaming it
  // would orphan every project already saved and break projects_done in the
  // ledger, its weight in weights.ts and its entry in lib/rank.js. The name is
  // free to change, the id never is.
  { id: 'projects', name: 'Lists', file: 'tiles/lists.html', size: 'big', page: true,
    sub: 'Daily, weekly, grocery, projects', cat: 'core', glyph: 'list' },
  { id: 'checkin',  name: 'Check in', file: 'tiles/checkin.html',  size: 's', page: true },
  { id: 'body',     name: 'Body',     file: 'tiles/body.html',     size: 's', page: true },
  { id: 'recovery', name: 'Recovery', file: 'tiles/recovery.html', size: 'm', page: true },
  // 'big' because this one has the most to say on the poster: the rank badge,
  // the Lift Points bar and the week's volume all have to fit beside the number.
  { id: 'lifting',  name: 'Lifting',  file: 'tiles/lifting.html',  size: 'big', page: true },
  { id: 'progress', name: 'Progress', file: 'tiles/progress.html', size: 'm', page: true },
  // Reports NOTHING to the ledger, on purpose, and so carries no weight in
  // weights.ts. A count of notes is not progress toward any of the three
  // goals, and reporting one would put a meaningless row in the ledger and
  // then invite a weight to make it mean something. See the tile's header.
  { id: 'notes',    name: 'Notes',    file: 'tiles/notes.html',    size: 'm', page: true },
]
