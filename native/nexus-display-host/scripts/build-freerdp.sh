#!/usr/bin/env bash
# Builds a minimal, from-source FreeRDP into vendor/freerdp — deliberately
# NOT the Homebrew `freerdp` formula, which pulls in FFmpeg built with
# x264/x265 (GPL-3.0-or-later). This build disables FFmpeg (and Opus, whose
# pkg-config include wiring is broken on this FreeRDP release anyway — we
# don't need RDP audio redirection for a display-only viewer) so every
# resulting dependency is permissively licensed:
#   FreeRDP/WinPR itself   Apache-2.0
#   OpenSSL                Apache-2.0
#   uriparser               BSD-3-Clause
#   jansson                 MIT
#   zlib                    zlib (system-provided)
# See native/nexus-display-host/README.md for the full rationale.
#
# Only vendor/freerdp/{include,lib} (the install prefix) is committed to the
# working tree's expectations via .gitignore exclusion — this script
# regenerates it from scratch each time, cloning FreeRDP into a throwaway
# temp directory that's removed afterward.
set -euo pipefail

FREERDP_TAG="3.31.1"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ADDON_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
VENDOR_DIR="$ADDON_DIR/vendor/freerdp"

if [[ "$(uname)" != "Darwin" ]]; then
  echo "build-freerdp.sh is macOS-only" >&2
  exit 1
fi

for tool in cmake ninja git pkg-config brew; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "Missing required tool: $tool (try: brew install cmake ninja)" >&2
    exit 1
  fi
done

OPENSSL_PREFIX="$(brew --prefix openssl@3)"
URIPARSER_PREFIX="$(brew --prefix uriparser 2>/dev/null || true)"
JANSSON_PREFIX="$(brew --prefix jansson 2>/dev/null || true)"
if [[ -z "$URIPARSER_PREFIX" || -z "$JANSSON_PREFIX" ]]; then
  echo "Missing uriparser/jansson — run: brew install uriparser jansson" >&2
  exit 1
fi

WORK_DIR="$(mktemp -d /tmp/nexus-freerdp-build.XXXXXX)"
trap 'rm -rf "$WORK_DIR"' EXIT

echo "[build-freerdp] Cloning FreeRDP $FREERDP_TAG..."
git clone --quiet --depth 1 --branch "$FREERDP_TAG" https://github.com/FreeRDP/FreeRDP.git "$WORK_DIR/src"

echo "[build-freerdp] Configuring (FFmpeg/Opus disabled, client/server binaries disabled, only the disp+drdynvc channels enabled)..."
# WITH_CLIENT_COMMON=ON builds libfreerdp-client (client.c/cmdline.c), which
# provides freerdp_client_load_channels/freerdp_client_load_addins — the
# generic, non-X11/SDL-specific machinery RdpBackend uses to load the "disp"
# (Display Control, MS-RDPEDISP) dynamic virtual channel for live
# desktop-resize support. WITH_CLIENT/WITH_CLIENT_SDL stay OFF: those build
# the actual xfreerdp/SDL client *binaries*, which need X11/SDL and which we
# don't use — we only want the reusable client-common library.
#
# Every other channel is explicitly disabled: several pull in extra
# dependencies we don't need for this (libusb for urbdrc, libfido2/libcbor
# for rdpewa, KRB5 for rdpear, ALSA for rdpsnd/audin) and none of them are
# used by this addon today. Re-enabling one later just means dropping it
# from this list (and, if it needs a library, adding that to the
# prerequisites in README.md).
cmake -S "$WORK_DIR/src" -B "$WORK_DIR/build" -G Ninja \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_INSTALL_PREFIX="$VENDOR_DIR" \
  -DCMAKE_OSX_DEPLOYMENT_TARGET=12.0 \
  -DBUILD_SHARED_LIBS=ON \
  -DWITH_FFMPEG=OFF \
  -DWITH_SWSCALE=OFF \
  -DWITH_CAIRO=OFF \
  -DWITH_JPEG=OFF \
  -DWITH_OPUS=OFF \
  -DWITH_CLIENT_COMMON=ON \
  -DWITH_CLIENT=OFF \
  -DWITH_CLIENT_SDL=OFF \
  -DWITH_SAMPLE=OFF \
  -DWITH_SERVER=OFF \
  -DWITH_CHANNELS=ON \
  -DWITH_CLIENT_CHANNELS=ON \
  -DCHANNEL_DISP=ON \
  -DCHANNEL_DISP_CLIENT=ON \
  -DCHANNEL_DRDYNVC=ON \
  -DCHANNEL_DRDYNVC_CLIENT=ON \
  -DCHANNEL_AINPUT=OFF \
  -DCHANNEL_AUDIN=OFF \
  -DCHANNEL_CLIPRDR=OFF \
  -DCHANNEL_ECHO=OFF \
  -DCHANNEL_ENCOMSP=OFF \
  -DCHANNEL_GEOMETRY=OFF \
  -DCHANNEL_GFXREDIR=OFF \
  -DCHANNEL_LOCATION=OFF \
  -DCHANNEL_RAIL=OFF \
  -DCHANNEL_RDP2TCP=OFF \
  -DCHANNEL_RDPDR=OFF \
  -DCHANNEL_RDPEAR=OFF \
  -DCHANNEL_RDPECAM=OFF \
  -DCHANNEL_RDPEI=OFF \
  -DCHANNEL_RDPEMSC=OFF \
  -DCHANNEL_RDPEWA=OFF \
  -DCHANNEL_RDPGFX=OFF \
  -DCHANNEL_RDPSND=OFF \
  -DCHANNEL_REMDESK=OFF \
  -DCHANNEL_SMARTCARD=OFF \
  -DCHANNEL_SSHAGENT=OFF \
  -DCHANNEL_TELEMETRY=OFF \
  -DCHANNEL_TSMF=OFF \
  -DCHANNEL_URBDRC=OFF \
  -DCHANNEL_VIDEO=OFF \
  -DBUILD_TESTING=OFF \
  -DWITH_MANPAGES=OFF \
  -DWITH_CCACHE=OFF \
  -DOPENSSL_ROOT_DIR="$OPENSSL_PREFIX" \
  >/dev/null

echo "[build-freerdp] Building..."
cmake --build "$WORK_DIR/build" -j "$(sysctl -n hw.ncpu)" >/dev/null

echo "[build-freerdp] Installing to $VENDOR_DIR..."
rm -rf "$VENDOR_DIR"
cmake --install "$WORK_DIR/build" >/dev/null

echo "[build-freerdp] Verifying no GPL/FFmpeg dependency leaked in..."
for dylib in "$VENDOR_DIR"/lib/*.dylib; do
  if otool -L "$dylib" | grep -qiE "ffmpeg|libav|libsw|libpostproc"; then
    echo "FATAL: $dylib links against FFmpeg — build config regressed" >&2
    exit 1
  fi
done

echo "[build-freerdp] Done. Vendored FreeRDP $FREERDP_TAG at $VENDOR_DIR"
