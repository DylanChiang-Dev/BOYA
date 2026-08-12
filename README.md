# BOYA Desktop

BOYA Desktop 0.2 is a minimal macOS desktop client for the official
[Pi coding agent](https://github.com/earendil-works/pi/tree/main/packages/coding-agent).
It keeps the researcher in control while Pi works only inside one selected
local folder.

## Scope

- macOS 13 or newer on Apple Silicon.
- OpenAI API keys stored in macOS Keychain.
- OpenAI models reported by the pinned Pi runtime, with `gpt-5.6-terra` as the default.
- Multiple Pi JSONL sessions per workspace: create, switch, rename, and recoverably archive.
- Streaming Markdown, tool progress, one-time approvals, abort, and crash recovery.
- Traditional Chinese UI. Source code, runtime policy, and repository documentation remain English.

BOYA 0.2 intentionally does not include skills, MCP, notebooks, provenance,
runs, artifacts, remote compute, OAuth, subagents, or project management.

## Runtime and security

The app pins official Pi `v0.84.1` by release archive and per-file SHA-256.
Tauri starts Pi in RPC mode with explicit tools and one explicit BOYA policy
extension. Project extensions, skills, prompt templates, themes, context-file
discovery, package installation, telemetry, and update checks are disabled.

Pi runs in a macOS sandbox limited to its bundled assets, the active workspace,
and BOYA private session storage. Shell commands run in a second sandbox with
no network or Keychain access. Sensitive files and symlink escapes are denied;
editing or overwriting an existing file requires approval, and every shell
command requires a separate one-time approval.

The OpenAI key never enters the workspace, session JSONL, command line, logs,
or the shell environment. Pi resolves it from Keychain through the fixed
app-private `auth.json` command.

## Development

Prerequisites: macOS 13+, Apple Silicon, Node.js 20+, pnpm 10.15.1, Rust, and Xcode
Command Line Tools.

```bash
pnpm install --frozen-lockfile
scripts/dev/fetch-pi.sh
scripts/dev/smoke-pi-rpc.sh

pnpm test
pnpm typecheck
pnpm lint
pnpm build
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
pnpm --filter @boya/desktop tauri dev
```

Build unsigned Apple Silicon packages:

```bash
pnpm --filter @boya/desktop tauri build \
  --target aarch64-apple-darwin \
  --bundles app,dmg
```

## Repository structure

- `apps/desktop/`: React UI and the Tauri host.
- `apps/desktop/src-tauri/agent-runtime/`: the explicit BOYA Pi extension.
- `packages/sdk/`: backend-neutral `AgentRuntimeClient` contracts and protocol helpers.
- `scripts/dev/`: pinned Pi acquisition, verification, and RPC smoke checks.

## Data migration

BOYA 0.2 starts a new app-private Pi session area. It does not migrate or
delete earlier OpenCode sessions, settings, research data, or other private app
state.

Third-party notices and bundled licenses are listed in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
