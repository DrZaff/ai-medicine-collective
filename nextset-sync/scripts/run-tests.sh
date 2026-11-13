#!/usr/bin/env bash
# Runs every test that does not need hardware:
#   1. the watch code in the real Espruino 2v29 interpreter (46 checks)
#   2. the Swift core (models, protocol, sync engine, Sleep Log parsing,
#      storage, CSV, imports), including the engine against the real watch code
# Usage: scripts/run-tests.sh            (builds Espruino on first run)
#        ESPRUINO=/path/to/espruino scripts/run-tests.sh
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
esp="${ESPRUINO:-$("$here/scripts/build-espruino.sh" | tail -1)}"
echo "== Watch code in Espruino ($esp)"
ESPRUINO="$esp" node "$here/watch/test/run.mjs"
echo "== Swift core"
cd "$here/ios/NextSetSyncCore"
NSYNC_ESPRUINO="$esp" swift test 2>&1 | tee /tmp/nsync-swift-test.log | grep -E "error:|failed|Executed .* tests" || true
grep -q "with 0 failures" /tmp/nsync-swift-test.log && ! grep -q " failed " /tmp/nsync-swift-test.log
echo "ALL TESTS PASSED"
