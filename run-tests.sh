#!/bin/sh
# Every check on this board, in one command. Plain node, no framework, no
# install. Run it before you push.
set -e
cd "$(dirname "$0")"
node lib/rank.test.js
node lib/shell.test.js
node lib/backup.test.js
node tools/icons.test.js
node tools/push.test.js
node tiles/lifting.lasttime.test.js
node tiles/lifting.splits.test.js
node tiles/lifting.unilateral.test.js
node tiles/lifting.grouping.test.js
node tiles/lifting.suggest.test.js
node tiles/lifting.bodymap.test.js
node tiles/lifting.rest.test.js
node tiles/lifting.routines.test.js
node tiles/lifting.supersets.test.js
node tiles/lifting.bodyweight.test.js
node tiles/lists.test.js
node tiles/lists.calendar.test.js
echo "All suites passed."

# The browser checks (paint, close-button collision, touch targets) are
# optional and not part of the "all suites passed" line
# above ON PURPOSE: it needs a Chromium binary on disk and the board actually
# running on :3000, neither of which the plain-node suites require, and this
# script should stay usable with nothing installed. Skip quietly rather than
# fail the whole run over an absent dev dependency - but say so, once, so it
# is never silently forgotten. See tools/visual-check.js for what it caught
# the first time it ran and why it exists.
if [ -d tools/node_modules ]; then
  echo
  echo "Running the visual checks too (tools/node_modules present)..."
  (cd tools && npm run check)
else
  echo
  echo "Skipped the visual check: tools/node_modules not installed."
  echo "  cd tools && npm install && npm run install-browser    (once)"
fi
