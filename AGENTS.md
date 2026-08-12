# Boya Desktop

Private desktop product repository for a local-first humanities and
social-science research workbench.

## Product invariants

- Human-in-the-loop is non-negotiable. Never introduce an autonomous research
  pipeline or let the agent choose research questions, sources, frameworks,
  methods, interpretations, arguments, venues, or final authorship.
- BOYA Desktop 0.2 does not load skills. If skills return in a later release,
  the public `DylanChiang-Dev/BOYA-skills` repository remains their only source
  of truth; never fork or edit that content privately.
- Never fabricate references, facts, data, journal requirements, or completed
  verification. Preserve provenance and make uncertainty visible.
- Model-provider secrets stay in app-private storage and never enter the
  workspace, provenance, logs, exports, or git.

## Architecture

- `apps/desktop/`: Tauri 2 + React + TypeScript + Vite.
- `packages/sdk/`: backend-neutral runtime contracts and JSONL protocol helpers.
- `apps/desktop/src-tauri/src/agent_runtime.rs`: Pi process, session, Keychain,
  sandbox, and normalized event host.
- `apps/desktop/src-tauri/agent-runtime/`: the explicit BOYA Pi policy extension.
- `scripts/dev/`: pinned Pi acquisition, verification, and RPC smoke checks.

Keep the frontend, desktop host, and runtime decoupled. The agent may only
access the active workspace. Existing-file overwrite and destructive commands
require one-time approval. Dependency installation and remote access are denied.

## Working conventions

- Discussion defaults to Chinese; source code and repository documentation use English.
- Keep changes small and verifiable. Update `PROGRESS.md` only for completed milestones.
- Use `upstream` as fetch-only. Never push to it.
- Run the Pi pin check and RPC smoke test, frontend tests, typecheck, lint, Rust
  tests, audit, and the Apple Silicon package build before pushing product changes.
