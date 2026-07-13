#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PACK="$ROOT/runtime/skills/external/boya"
EXPECTED_COMMIT="591a37153c7b73a0d509981dd7e8028350e47761"
EXPECTED_IDS="academic-revision ai-use-disclosure bilingual-abstract boya citation-format journal-fit literature-analysis literature-search manuscript-review paper-outline reference-check research-design research-question theoretical-framework thesis-defense-prep"

[ -d "$PACK" ] || { echo "Boya skill pack is missing; run scripts/dev/fetch-skills.sh" >&2; exit 1; }
[ "$(cat "$PACK/.commit")" = "$EXPECTED_COMMIT" ] || { echo "Unexpected Boya skill commit" >&2; exit 1; }

ACTUAL_IDS="$(for dir in "$PACK"/*; do [ -d "$dir" ] && basename "$dir"; done | sort | tr '\n' ' ' | sed 's/ $//')"
[ "$ACTUAL_IDS" = "$EXPECTED_IDS" ] || {
  echo "Unexpected Boya skill set" >&2
  echo "expected: $EXPECTED_IDS" >&2
  echo "actual:   $ACTUAL_IDS" >&2
  exit 1
}

[ -f "$PACK/boya/SKILL.md" ] || { echo "Missing boya entry skill" >&2; exit 1; }
[ ! -e "$PACK/ai4s-agent" ] || { echo "Autonomous ai4s-agent must not be present" >&2; exit 1; }

echo "Boya skill pack verified: 15 skills at ${EXPECTED_COMMIT:0:7}"
