# BOYA Repository

This repository contains the BOYA Desktop product and the official BOYA
research skills. Desktop source is proprietary; the bundled skills remain the
public skills source of truth and retain their MIT license.

## Product boundaries

- Human-in-the-loop is non-negotiable. Never let an agent choose research
  questions, sources, frameworks, methods, interpretations, arguments, venues,
  or final authorship.
- BOYA Desktop may load only the official skills shipped in this repository.
  The runtime must not discover project-local or third-party skills.
- Never fabricate references, facts, journal requirements, or completed
  verification. Preserve provenance and make uncertainty visible.
- Model-provider secrets and the BOYA account bearer token stay in private
  native storage. They never enter the workspace, prompts, logs, exports, or
  frontend state.

## Repository layout

- `apps/desktop/`: Tauri 2 + React + TypeScript + Vite product UI.
- `apps/desktop/src-tauri/`: native host, authentication, Pi runtime, Keychain,
  sandbox, and normalized event handling.
- `packages/sdk/`: backend-neutral runtime contracts and JSONL protocol helpers.
- `skills/`: the official 17-skill BOYA library and its single source of truth.
- `evals/`, `examples/`, `knowledge/`, `templates/`, and `scripts/`: supporting
  material for the official skills.

## Skills rules

- `skills/<name>/SKILL.md` is the canonical rule file for each skill.
- Before changing a skill, read `CONVENTIONS.md` and update the relevant evals.
- Human approval gates must remain explicit; do not introduce autonomous
  research pipelines or unattended multi-agent orchestration.
- Never invent sources or turn a failed lookup into a false claim. Mark missing
  evidence as requiring human confirmation.
- The root `README.md` is the product entry point. Keep the skill installation
  and workflow documentation consistent with the bundled manifest.

## Desktop rules

- The agent may access only the active workspace. Existing-file overwrite and
  destructive commands require one-time approval.
- The desktop account token is held by Rust and stored in the macOS Keychain;
  it must never be passed to React, Pi, the workspace, command lines, or logs.
- Device login uses only the fixed BOYA Web client and scope. Do not add a
  second desktop account database or integrate Sub2API.
- Never call a blocking Tauri dialog API from a synchronous command. Run the
  picker off the main thread.
- Keep model-provider configuration in persistent app settings, not a first-run
  gate. Provider keys are stored per provider in the macOS Keychain.

## Verification

Run the relevant frontend tests, typecheck, lint, Rust tests, skills checks,
and package/build checks before shipping. Verify a freshly installed bundle;
an old `/Applications/BOYA Desktop.app` can hide shipped changes.

Use `desktop-v*` tags for Desktop releases and `skills-v*` tags for Skills
releases. Keep `upstream` fetch-only and do not push it.
