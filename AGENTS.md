# Boya Desktop

Private desktop product repository for a local-first humanities and
social-science research workbench.

## Product invariants

- Human-in-the-loop is non-negotiable. Never introduce an autonomous research
  pipeline or let the agent choose research questions, sources, frameworks,
  methods, interpretations, arguments, venues, or final authorship.
- The public `DylanChiang-Dev/BOYA-skills` repository is the only source of truth for
  Boya skills. This repository may pin and bundle it, but must not fork or edit
  the skill content privately.
- Never fabricate references, facts, data, journal requirements, or completed
  verification. Preserve provenance and make uncertainty visible.
- Model-provider secrets stay in app-private storage and never enter the
  workspace, provenance, logs, exports, or git.

## Architecture

- `apps/desktop/`: Tauri 2 + React + TypeScript + Vite.
- `packages/sdk/`: the only frontend boundary to the bundled OpenCode runtime.
- `packages/shared/`: stable domain types.
- `runtime/harness/`: rules seeded into new research workspaces.
- `runtime/skills/`: curated utility skills; Boya and office skills are fetched
  at pinned commits into the ignored `external/` directory.

Keep the frontend, desktop host, and runtime decoupled. The agent may only
access the active workspace. Destructive commands, dependency installation,
and remote access require approval.

## Working conventions

- Discussion defaults to Chinese; source code and repository documentation use English.
- Keep changes small and verifiable. Update `PROGRESS.md` only for completed milestones.
- Use `upstream` as fetch-only. Never push to it.
- Run the skill pin check, frontend tests, typecheck, lint, Rust tests, and audit
  before pushing product changes.
