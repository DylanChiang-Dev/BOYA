# apps/desktop

The Tauri 2 + React + TypeScript + Vite application for BOYA Desktop 0.3.

## Layout

- `src/App.tsx`: the Traditional Chinese workspace, sessions, chat, approvals,
  and settings UI.
- `src/lib/agentClient.ts`: the Tauri implementation of `AgentRuntimeClient`.
- `src/lib/agentStore.ts`: normalized runtime and UI state in Zustand.
- `src-tauri/src/auth.rs`: BOYA Web Device Authorization, bearer session
  validation, offline grace, and Keychain storage.
- `src-tauri/src/agent_runtime.rs`: native Pi RPC lifecycle, sessions, Keychain,
  bundled Skills, sandbox profiles, and Tauri commands.
- `src-tauri/agent-runtime/boya-policy.ts`: the explicit BOYA Pi policy extension.
- `src-tauri/binaries/`: ignored, pinned Pi resources fetched for local builds.

## Boundaries

The React frontend imports runtime types only from `packages/sdk` and talks to
the native host only through `DesktopAgentClient`. Pi RPC frames and process
details do not enter React. The Rust host emits normalized events on the single
`agent-runtime-event` channel.

Pi can access only the selected workspace and BOYA private session storage.
Provider credentials are stored in macOS Keychain and are never passed to the
frontend or shell environment. The account bearer token is held only by Rust,
and Pi receives only the official bundled Skills through explicit `--skill`
arguments.

## Checks

```bash
pnpm --filter @boya/desktop test
pnpm --filter @boya/desktop typecheck
pnpm --filter @boya/desktop lint
cargo test --manifest-path src-tauri/Cargo.toml
```
