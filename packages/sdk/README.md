# packages/sdk

Backend-neutral contracts between the BOYA frontend and its bundled agent
runtime.

`AgentRuntimeClient` exposes runtime lifecycle, prompt and abort, session CRUD,
history, models, approvals, and normalized event subscription. React does not
import Pi RPC types or know how the native host transports those operations.

The package also provides two protocol helpers used by tests and native bridge
development:

- `JsonlDecoder` buffers strict LF-delimited JSON frames.
- `PiEventNormalizer` converts Pi events into `RuntimeEvent` values without
  exposing raw Pi structures to application code.

Runtime acquisition, pinning, process management, Keychain access, and sandbox
policy belong to the Tauri host rather than this package.
