#!/usr/bin/env bash
# Fetch the pinned external skill packs into runtime/skills/external/
# (git-ignored; bundled into the installer as Tauri resources).
# Runs locally and in CI so the skills never live in this repo's git history.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

# ---- Boya: the human-in-the-loop research workflow ----
BOYA_SKILLS_COMMIT="${BOYA_SKILLS_COMMIT:-ad7f7919ab30adf4cddfe11faf1883e0503089f6}"
OUT_DIR="$ROOT/runtime/skills/external/boya"

BOYA_TMP=""
if [ -n "${BOYA_SKILLS_SOURCE_DIR:-}" ]; then
  SRC="$(cd "$BOYA_SKILLS_SOURCE_DIR" && pwd)"
  RESOLVED_BOYA_COMMIT="$(git -C "$SRC" rev-parse HEAD)"
  echo "Using local Boya source $SRC at ${RESOLVED_BOYA_COMMIT:0:7}"
else
  URL="https://github.com/DylanChiang-Dev/BOYA-skills/archive/${BOYA_SKILLS_COMMIT}.tar.gz"
  BOYA_TMP="$(mktemp -d)"
  echo "Downloading $URL"
  curl -fsSL "$URL" -o "$BOYA_TMP/skills.tar.gz"
  tar -xzf "$BOYA_TMP/skills.tar.gz" -C "$BOYA_TMP"

  SRC=""
  for candidate in "$BOYA_TMP"/BOYA-skills-*; do
    [ -d "$candidate" ] && SRC="$candidate" && break
  done
  RESOLVED_BOYA_COMMIT="$BOYA_SKILLS_COMMIT"
fi
[ -d "$SRC/skills" ] || { echo "No skills/ directory in archive" >&2; exit 1; }
[ -f "$SRC/skills-manifest.json" ] || { echo "No skills-manifest.json in Boya source" >&2; exit 1; }

MANIFEST_VERSION="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["version"])' "$SRC/skills-manifest.json")"
MANIFEST_COUNT="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["skill_count"])' "$SRC/skills-manifest.json")"
MANIFEST_IDS="$(python3 -c 'import json,sys; print(" ".join(sorted(x["id"] for x in json.load(open(sys.argv[1]))["skills"])))' "$SRC/skills-manifest.json")"
ACTUAL_IDS="$(for dir in "$SRC"/skills/*; do [ -f "$dir/SKILL.md" ] && basename "$dir"; done | sort | tr '\n' ' ' | sed 's/ $//')"
[ "$MANIFEST_VERSION" = "2.1.0" ] || { echo "Expected Boya 2.1.0, found $MANIFEST_VERSION" >&2; exit 1; }
[ "$MANIFEST_COUNT" = "17" ] || { echo "Expected 17 Boya skills, found $MANIFEST_COUNT" >&2; exit 1; }
[ "$MANIFEST_IDS" = "$ACTUAL_IDS" ] || { echo "Boya manifest and skill directories differ" >&2; exit 1; }
[ -f "$SRC/skills/boya/SKILL.md" ] || { echo "Missing Boya entry skill" >&2; exit 1; }
[ -f "$SRC/skills/claim-audit/SKILL.md" ] || { echo "Missing claim-audit skill" >&2; exit 1; }
[ -f "$SRC/skills/research-record/SKILL.md" ] || { echo "Missing research-record skill" >&2; exit 1; }
[ ! -d "$SRC/skills/ai4s-agent" ] || { echo "Autonomous ai4s-agent must not be bundled" >&2; exit 1; }

rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"
cp -R "$SRC/skills/." "$OUT_DIR/"
cp "$SRC/skills-manifest.json" "$OUT_DIR/skills-manifest.json"
echo "$RESOLVED_BOYA_COMMIT" > "$OUT_DIR/.commit"
[ -z "$BOYA_TMP" ] || rm -rf "$BOYA_TMP"

echo "Placed boya@${RESOLVED_BOYA_COMMIT:0:7} ($MANIFEST_COUNT skills, v$MANIFEST_VERSION) in $OUT_DIR:"
ls "$OUT_DIR"

# ---- Anthropic document skills: docx / pdf / pptx / xlsx ----
# From the Apache-2.0 licensed anthropics/skills repo (each skill directory
# carries its own LICENSE.txt, kept by the copy below).
ANTHROPIC_SKILLS_COMMIT="${ANTHROPIC_SKILLS_COMMIT:-9d2f1ae187231d8199c64b5b762e1bdf2244733d}"
OFFICE_SKILLS="docx pdf pptx xlsx"
OFFICE_OUT="$ROOT/runtime/skills/external/anthropic-skills"

URL="https://github.com/anthropics/skills/archive/${ANTHROPIC_SKILLS_COMMIT}.tar.gz"
TMP="$(mktemp -d)"
echo "Downloading $URL"
curl -fsSL "$URL" -o "$TMP/skills.tar.gz"
tar -xzf "$TMP/skills.tar.gz" -C "$TMP"

SRC=""
for candidate in "$TMP"/skills-*; do
  [ -d "$candidate" ] && SRC="$candidate" && break
done
rm -rf "$OFFICE_OUT"
mkdir -p "$OFFICE_OUT"
for s in $OFFICE_SKILLS; do
  [ -f "$SRC/skills/$s/SKILL.md" ] || { echo "No skills/$s/SKILL.md in archive" >&2; exit 1; }
  cp -R "$SRC/skills/$s" "$OFFICE_OUT/$s"
done
echo "$ANTHROPIC_SKILLS_COMMIT" > "$OFFICE_OUT/.commit"
rm -rf "$TMP"

echo "Placed anthropic-skills@${ANTHROPIC_SKILLS_COMMIT:0:7} in $OFFICE_OUT:"
ls "$OFFICE_OUT"
