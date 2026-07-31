#!/bin/sh
# Every check on this board, in one command. Plain node, no framework, no
# install. Run it before you push.
set -e
cd "$(dirname "$0")"
node lib/rank.test.js
node lib/shell.test.js
node tiles/lifting.lasttime.test.js
node tiles/lifting.splits.test.js
echo "All suites passed."
