#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PACK="$ROOT/runtime/skills/external/boya"
EXPECTED_COMMIT="ad7f7919ab30adf4cddfe11faf1883e0503089f6"

[ -d "$PACK" ] || { echo "Boya skill pack is missing; run scripts/dev/fetch-skills.sh" >&2; exit 1; }
[ "$(cat "$PACK/.commit")" = "$EXPECTED_COMMIT" ] || { echo "Unexpected Boya skill commit" >&2; exit 1; }

ACTUAL_IDS="$(for dir in "$PACK"/*; do [ -d "$dir" ] && basename "$dir"; done | sort | tr '\n' ' ' | sed 's/ $//')"
[ -f "$PACK/skills-manifest.json" ] || { echo "Missing Boya skills manifest" >&2; exit 1; }
MANIFEST_VERSION="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["version"])' "$PACK/skills-manifest.json")"
MANIFEST_COUNT="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["skill_count"])' "$PACK/skills-manifest.json")"
EXPECTED_IDS="$(python3 -c 'import json,sys; print(" ".join(sorted(x["id"] for x in json.load(open(sys.argv[1]))["skills"])))' "$PACK/skills-manifest.json")"
[ "$MANIFEST_VERSION" = "2.1.0" ] || { echo "Unexpected Boya version" >&2; exit 1; }
[ "$MANIFEST_COUNT" = "17" ] || { echo "Unexpected Boya skill count" >&2; exit 1; }
[ "$ACTUAL_IDS" = "$EXPECTED_IDS" ] || {
  echo "Unexpected Boya skill set" >&2
  echo "expected: $EXPECTED_IDS" >&2
  echo "actual:   $ACTUAL_IDS" >&2
  exit 1
}

[ -f "$PACK/boya/SKILL.md" ] || { echo "Missing boya entry skill" >&2; exit 1; }
[ -f "$PACK/claim-audit/scripts/claim_audit.py" ] || { echo "Missing claim-audit standard library" >&2; exit 1; }
[ -f "$PACK/research-record/scripts/research_record.py" ] || { echo "Missing research-record standard library" >&2; exit 1; }
[ ! -e "$PACK/ai4s-agent" ] || { echo "Autonomous ai4s-agent must not be present" >&2; exit 1; }

echo "Boya skill pack verified: $MANIFEST_COUNT skills at ${EXPECTED_COMMIT:0:7} (v$MANIFEST_VERSION)"
