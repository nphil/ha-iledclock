#!/usr/bin/env bash
# Compiles the vendor iLedClock encoder classes (copied verbatim from the
# decompiled CoolLED1248 app) together with the minimal stubs under
# stubs/, then runs the Golden harness to regenerate vectors.json.
#
# Usage: bash build.sh
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="$HERE/out"
JAVAC="${JAVAC:-/usr/bin/javac}"
JAVA="${JAVA:-/usr/bin/java}"

rm -rf "$OUT"
mkdir -p "$OUT"

mapfile -t SOURCES < <(find "$HERE/vendor" "$HERE/stubs" "$HERE/harness" -name '*.java' | sort)

echo "Compiling ${#SOURCES[@]} source files..."
"$JAVAC" -encoding UTF-8 -nowarn -d "$OUT" "${SOURCES[@]}"

echo "Running Golden harness..."
"$JAVA" -cp "$OUT" -Duser.timezone=UTC Golden "$HERE/vectors.json"

echo "Wrote $HERE/vectors.json"
