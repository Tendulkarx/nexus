#!/usr/bin/env bash
# Idempotent guard in front of build-freerdp.sh — `npm run build` (node-gyp
# rebuild) needs vendor/freerdp/lib to exist, but re-cloning and rebuilding
# FreeRDP from source on every addon rebuild would be needlessly slow.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ADDON_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

if [[ -f "$ADDON_DIR/vendor/freerdp/lib/libfreerdp3.dylib" ]]; then
  echo "[ensure-freerdp] vendor/freerdp already built, skipping (run 'npm run build:freerdp' to rebuild)"
  exit 0
fi

exec "$SCRIPT_DIR/build-freerdp.sh"
