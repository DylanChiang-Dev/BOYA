# Boya Desktop

Boya Desktop is a local-first AI research workbench for humanities and social
sciences. It combines the human-in-the-loop [Boya](https://github.com/DylanChiang-Dev/BOYA-skills)
workflow with a desktop workspace for files, notebooks, runs, and provenance.

This repository is private. An unsigned macOS Apple Silicon preview is built
for public distribution through the BOYA website and Cloudflare R2. There are
no accounts, credits, payments, or production Boya Cloud API in this milestone.

## Product rules

- AI does research labor; the researcher makes research decisions.
- Research questions, source selection, frameworks, methods, interpretation,
  arguments, and final submission choices always stop for human confirmation.
- References and factual claims must return to real sources. Missing evidence
  stays pending and is never fabricated.
- The public `BOYA-skills` repository is the only source of truth for workflow skills.
  Desktop builds fetch a pinned commit instead of editing a private copy.
- The autonomous `ai4s-agent` research pipeline is intentionally not bundled.

## Included in 0.1.0

- Tauri 2 desktop shell with a bundled OpenCode sidecar.
- Local workspaces, files, notebooks, run records, and `.boya/` provenance.
- The complete 17-skill Boya v2.1.0 workflow pinned at commit `ad7f791`, including claim-to-source auditing and optional research records.
- Document tools for DOCX, PDF, PPTX, and XLSX.
- Curated traceability, statistics, large-file, and publication-figure tools.
- Traditional Chinese, Simplified Chinese, English, and Japanese interfaces.
- Boya Cloud as the default product mode, marked as coming soon.
- Developer BYOK mode for local development and model-provider testing.

## Development

Prerequisites: Node.js 20+, pnpm 9, Rust, and the platform dependencies required
by Tauri 2.

```bash
pnpm install --frozen-lockfile
bash scripts/dev/fetch-opencode.sh aarch64-apple-darwin
bash scripts/dev/fetch-uv.sh aarch64-apple-darwin
bash scripts/dev/fetch-skills.sh
bash scripts/dev/check-boya-skills.sh
bash scripts/dev/check-brand-isolation.sh

pnpm test
pnpm typecheck
pnpm lint
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
pnpm --filter @boya/desktop tauri dev
```

Build the unsigned macOS Apple Silicon app with:

```bash
pnpm --filter @boya/desktop tauri build --target aarch64-apple-darwin --bundles app,dmg
```

The manual `macos-alpha` GitHub Actions job also packages
`BOYA-Desktop_0.1.0_aarch64.dmg` and its SHA-256 as a workflow artifact. Public
downloads are hosted outside this private repository; the app checks
`https://boya-website.pages.dev/releases/latest.json` for update metadata.

## Repository structure

- `apps/desktop/`: React frontend and Tauri host.
- `packages/sdk/`: typed OpenCode client and mock server.
- `packages/shared/`: stable desktop domain types.
- `runtime/harness/`: Boya workspace rules seeded into new projects.
- `runtime/skills/`: curated utility skills; external packs are fetched at build time.
- `scripts/dev/`: pinned sidecar and skill acquisition checks.

## Upstream and licensing

Boya Desktop is based on Open Science Desktop commit
`51c7fb648dbe9aad33dcb3358aefc0b3d6c8ae53`. The original project and its
contributors are credited in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md),
and the original MIT license is preserved under `LICENSES/`.

Boya-specific changes are private and unlicensed during incubation. Bundled
third-party components and skills retain their own licenses.
