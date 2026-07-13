#!/usr/bin/env bash
# Fetch the pinned external skill packs into runtime/skills/external/
# (git-ignored; bundled into the installer as Tauri resources).
# Runs locally and in CI so the skills never live in this repo's git history.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

# ---- Boya: the human-in-the-loop research workflow ----
BOYA_SKILLS_COMMIT="${BOYA_SKILLS_COMMIT:-591a37153c7b73a0d509981dd7e8028350e47761}"
OUT_DIR="$ROOT/runtime/skills/external/boya"

URL="https://github.com/DylanChiang-Dev/boya/archive/${BOYA_SKILLS_COMMIT}.tar.gz"
TMP="$(mktemp -d)"
echo "Downloading $URL"
curl -fsSL "$URL" -o "$TMP/skills.tar.gz"
tar -xzf "$TMP/skills.tar.gz" -C "$TMP"

SRC=""
for candidate in "$TMP"/boya-*; do
  [ -d "$candidate" ] && SRC="$candidate" && break
done
[ -d "$SRC/skills" ] || { echo "No skills/ directory in archive" >&2; exit 1; }

SKILL_COUNT="$(find "$SRC/skills" -type f -name SKILL.md | wc -l | tr -d ' ')"
[ "$SKILL_COUNT" = "15" ] || { echo "Expected 15 Boya skills, found $SKILL_COUNT" >&2; exit 1; }
[ -f "$SRC/skills/boya/SKILL.md" ] || { echo "Missing Boya entry skill" >&2; exit 1; }
[ ! -d "$SRC/skills/ai4s-agent" ] || { echo "Autonomous ai4s-agent must not be bundled" >&2; exit 1; }

rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"
cp -R "$SRC/skills/." "$OUT_DIR/"
echo "$BOYA_SKILLS_COMMIT" > "$OUT_DIR/.commit"
rm -rf "$TMP"

echo "Placed boya@${BOYA_SKILLS_COMMIT:0:7} in $OUT_DIR:"
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
