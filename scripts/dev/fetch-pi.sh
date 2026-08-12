#!/usr/bin/env bash
set -euo pipefail

PI_VERSION="v0.84.1"
PI_ARCHIVE_SHA256="683c84261f40b870b4a7ccf181a48ad6ecd71853b0112d1bb617539530c6121d"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RUNTIME_DIR="$ROOT_DIR/apps/desktop/src-tauri/binaries"
DESTINATION="$RUNTIME_DIR/pi-aarch64-apple-darwin"
TEMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TEMP_DIR"' EXIT

ARCHIVE="$TEMP_DIR/pi-darwin-arm64.tar.gz"
URL="https://github.com/earendil-works/pi/releases/download/${PI_VERSION}/pi-darwin-arm64.tar.gz"

curl --fail --location --retry 3 --output "$ARCHIVE" "$URL"
printf '%s  %s\n' "$PI_ARCHIVE_SHA256" "$ARCHIVE" | shasum -a 256 -c -
tar -xzf "$ARCHIVE" -C "$TEMP_DIR"
SOURCE="$(find "$TEMP_DIR" -type f -name pi -perm -111 -print -quit)"
test -n "$SOURCE"
mkdir -p "$RUNTIME_DIR/theme"
install -m 755 "$SOURCE" "$DESTINATION"
install -m 644 "$TEMP_DIR/pi/package.json" "$RUNTIME_DIR/package.json"
install -m 644 "$TEMP_DIR/pi/photon_rs_bg.wasm" "$RUNTIME_DIR/photon_rs_bg.wasm"
install -m 644 "$TEMP_DIR/pi/theme/dark.json" "$RUNTIME_DIR/theme/dark.json"
install -m 644 "$TEMP_DIR/pi/theme/light.json" "$RUNTIME_DIR/theme/light.json"
install -m 644 "$TEMP_DIR/pi/theme/theme-schema.json" "$RUNTIME_DIR/theme/theme-schema.json"
"$ROOT_DIR/scripts/dev/check-pi.sh"
