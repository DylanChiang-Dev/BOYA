#!/usr/bin/env python3
"""Build the public BOYA Skills catalog from the release manifest and UI metadata."""

from __future__ import annotations

import json
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MANIFEST_PATH = ROOT / "skills-manifest.json"
OUTPUT_PATH = ROOT / "skills-catalog.json"
DESKTOP_OUTPUT_PATH = ROOT / "apps" / "desktop" / "src" / "generated" / "skills-catalog.json"


def quoted_value(source: str, key: str) -> str:
    match = re.search(rf'^\s+{re.escape(key)}:\s+"([^"]+)"\s*$', source, re.MULTILINE)
    if not match:
        raise ValueError(f"missing interface.{key}")
    return match.group(1)


def main() -> None:
    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    skills = []
    for entry in manifest["skills"]:
        skill_id = entry["id"]
        metadata = (ROOT / "skills" / skill_id / "agents" / "openai.yaml").read_text(encoding="utf-8")
        skills.append({
            "id": skill_id,
            "role": entry["role"],
            "stage": entry["stage"],
            "displayName": quoted_value(metadata, "display_name"),
            "shortDescription": quoted_value(metadata, "short_description"),
            "defaultPrompt": quoted_value(metadata, "default_prompt"),
        })

    catalog = {
        "schemaVersion": 1,
        "name": "boya",
        "version": manifest["version"],
        "skillCount": len(skills),
        "skills": skills,
    }
    serialized = json.dumps(catalog, ensure_ascii=False, indent=2) + "\n"
    OUTPUT_PATH.write_text(serialized, encoding="utf-8")
    DESKTOP_OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    DESKTOP_OUTPUT_PATH.write_text(serialized, encoding="utf-8")


if __name__ == "__main__":
    main()
