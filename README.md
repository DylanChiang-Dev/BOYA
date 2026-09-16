# BOYA

BOYA is a local-first research workbench for humanities and social-science
researchers. BOYA Desktop provides the workspace and Pi runtime; the bundled
official Skills guide the user from a research question to a defensible paper.

The product has one public Skills source and one authenticated Desktop account:

- **BOYA Desktop 0.3**: macOS Apple Silicon desktop client with browser-based
  BOYA Account login, local workspaces, Pi sessions, and the official 17 Skills.
- **BOYA Skills**: the MIT-licensed `skills/` library. Skills remain directly
  downloadable and installable without an account.
- **BOYA Web**: the companion account and community service at
  `https://boya.caiada.edu.kg`. Desktop account data, membership, roles, and
  device sessions are managed there.

## Account and privacy

Desktop login uses the BOYA Web Device Authorization flow. The user signs in
with Email OTP or Google in a browser, approves the displayed device code, and
the native Rust host stores the resulting session only in the macOS Keychain.
The token is not exposed to React, Pi, the workspace, command lines, or logs.

Desktop is available to every signed-in member; VIP controls additional Web
content and entitlements. Research files, conversations, model keys, and
workspace paths stay local and are not sent to BOYA Web. A verified session can
use the documented seven-day offline grace period when the service is
unreachable; an explicit server revocation logs the user out immediately.

## Official Skills

The bundle contains 17 official Skills, with `boya` as the recommended entry
point: academic-revision, ai-use-disclosure, bilingual-abstract,
boya, citation-format, claim-audit, journal-fit, literature-analysis,
literature-search, manuscript-review, paper-outline, reference-check,
research-design, research-question, research-record, theoretical-framework,
and thesis-defense-prep.

The Desktop runtime disables ambient Skill discovery and passes only these
verified bundled Skills to Pi. Public Skills can also be installed manually
from this repository through an agent or by copying `skills/` into the target
agent's skills directory.

## Development

Prerequisites: macOS 13+, Apple Silicon, Node.js 20+, pnpm 10.15.1, Rust, and
Xcode Command Line Tools.

```bash
pnpm install --frozen-lockfile
scripts/dev/fetch-pi.sh
scripts/dev/smoke-pi-rpc.sh

pnpm test
pnpm typecheck
pnpm lint
pnpm build
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
python3 scripts/check-skills.py --check
python3 scripts/check-evals.py
```

Build an unsigned Apple Silicon package:

```bash
pnpm --filter @boya/desktop tauri build \
  --target aarch64-apple-darwin \
  --bundles app,dmg
```

## Repository structure

- `apps/desktop/`: React UI and Tauri host.
- `apps/desktop/src-tauri/agent-runtime/`: explicit BOYA Pi policy extension.
- `packages/sdk/`: runtime contracts and JSONL protocol helpers.
- `skills/`: official Skills source, licensed under MIT.
- `evals/`, `examples/`, `knowledge/`, `templates/`: Skills support material.
- `scripts/dev/`: pinned Pi acquisition, verification, and RPC smoke checks.

Desktop source and product assets are proprietary. The Skills license is
available at [`skills/LICENSE`](skills/LICENSE).
