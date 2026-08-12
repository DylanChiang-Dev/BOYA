#!/usr/bin/env bash
set -euo pipefail

PI_VERSION="0.84.1"
PI_BINARY_SHA256="782e11711c46583aee1e3a0c73a3ce3a84f81d66d6a910dd00b8e1aa43af74be"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RUNTIME_DIR="$ROOT_DIR/apps/desktop/src-tauri/binaries"
BINARY="$RUNTIME_DIR/pi-aarch64-apple-darwin"

test -x "$BINARY"
printf '%s  %s\n' "$PI_BINARY_SHA256" "$BINARY" | shasum -a 256 -c -
file "$BINARY" | grep -q 'Mach-O 64-bit executable arm64'
test "$($BINARY --version)" = "$PI_VERSION"

while read -r checksum path; do
  printf '%s  %s\n' "$checksum" "$RUNTIME_DIR/$path" | shasum -a 256 -c -
done <<'EOF'
f9aaa275eac3292508bd9a1325d705a41c2d24c9a34da2b690e400d5a761a985  package.json
10468181565c56004c867f3a4af96f89a0ef5a63a72f2b5fb12c1f1992a3615c  photon_rs_bg.wasm
3fe3f5663e56951e2afc134b738bce8da123e9c94463efe46068f6a8401ec98d  theme/dark.json
fa20c15846fb8255aac215fe94580f322dc918e7d76de7744e613f8630613d14  theme/light.json
78ce9039d9229e205e3a9bbb8b055c61153657adf841333b55a1ac24c6b1861e  theme/theme-schema.json
EOF
