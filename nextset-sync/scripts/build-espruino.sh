#!/usr/bin/env bash
# Builds the Espruino 2v29 interpreter for Linux or macOS, used by the watch
# tests to run the real watch code. Needs git, make and a C compiler.
#   scripts/build-espruino.sh            -> .espruino/bin/espruino
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
dir="$here/.espruino"
if [ ! -x "$dir/bin/espruino" ]; then
  rm -rf "$dir"
  git clone --depth 1 --branch RELEASE_2V29 https://github.com/espruino/Espruino "$dir"
  make -C "$dir" -j"$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo 4)" >/dev/null
fi
echo "$dir/bin/espruino"
