#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

FORBIDDEN='Open Science|OpenScience|AI4S|@ai4s|\.openscience|ai4s-workbench'
MATCHES="$(rg -n -i "$FORBIDDEN" \
    apps/desktop/index.html \
    apps/desktop/package.json \
    apps/desktop/src \
    apps/desktop/src-tauri/Cargo.toml \
    apps/desktop/src-tauri/src \
    apps/desktop/src-tauri/tauri.conf.json \
    packages/sdk/package.json \
    packages/shared/package.json \
    package.json \
    --glob '!*.test.*' \
    --glob '!i18n/locales/de/**' \
    --glob '!i18n/locales/es/**' \
    --glob '!i18n/locales/fr/**' \
    --glob '!i18n/locales/ko/**' || true)"
MATCHES="$(printf '%s\n' "$MATCHES" \
  | rg -v 'settings\.json:[0-9]+:.*Open Science Desktop' \
  | rg -v 'SettingsPage\.tsx:[0-9]+:.*github\.com/ai4s-research/open-science' || true)"

if [ -n "$MATCHES" ]; then
  echo "Legacy product branding remains in a production surface:" >&2
  echo "$MATCHES" >&2
  exit 1
fi

rg -q '"productName": "Boya Desktop"' apps/desktop/src-tauri/tauri.conf.json
rg -q '"identifier": "dev\.dylanchiang\.boya"' apps/desktop/src-tauri/tauri.conf.json
rg -q '"version": "0\.1\.0"' apps/desktop/src-tauri/tauri.conf.json
rg -q 'boya\.modelAccessMode' apps/desktop/src/lib/store.ts

echo "Boya production branding and metadata verified"
