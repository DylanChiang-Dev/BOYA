# scripts

Repository tooling.

- `dev/fetch-pi.sh` downloads the pinned Pi `v0.84.1` Apple Silicon release, verifies the archive, and extracts the binary plus required runtime assets.
- `dev/check-pi.sh` verifies the binary architecture, version, and every bundled runtime asset by SHA-256.
- `dev/smoke-pi-rpc.sh` starts the real bundled Pi inside the runtime sandbox, loads the BOYA policy extension, and validates correlated LF JSONL state and session responses without calling OpenAI.
- `release/` contains packaging and signing helpers.
