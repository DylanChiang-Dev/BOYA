# Tauri host

This directory contains the native boundary for BOYA Desktop 0.3.

Responsibilities:

- Store the OpenAI key in macOS Keychain.
- Store the BOYA Account bearer session in macOS Keychain and complete the
  browser-based Device Authorization flow without exposing the token to React.
- Start and supervise the pinned Pi RPC process.
- Load only the 17 verified official BOYA Skills bundled with the application.
- Normalize Pi JSONL events into the single `agent-runtime-event` channel.
- Keep Pi sessions in new app-private storage and archive them recoverably.
- Generate and enforce the macOS runtime and shell sandbox profiles.
- Expose the backend-neutral `AgentRuntimeClient` commands used by React.

Pi is never given an API key through arguments or the environment. The
app-private `auth.json` stores only a fixed Keychain lookup command. Runtime
policy lives in `agent-runtime/boya-policy.ts`; unavailable sandbox or approval
bridges fail closed.
