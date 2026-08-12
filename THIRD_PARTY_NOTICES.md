# Third-party notices

## Open Science Desktop

BOYA Desktop retains portions of the desktop shell originally derived from
Open Science Desktop:

- Source: https://github.com/ai4s-research/open-science
- Baseline: `51c7fb648dbe9aad33dcb3358aefc0b3d6c8ae53`
- License: MIT, preserved at `LICENSES/open-science-MIT.txt`

The git history is retained and the upstream repository is configured locally
as the fetch-only `upstream` remote.

## Pi coding agent

BOYA Desktop bundles the official Apple Silicon release of Pi coding agent:

- Source: https://github.com/earendil-works/pi/tree/main/packages/coding-agent
- Release: `v0.84.1`
- Package: `@earendil-works/pi-coding-agent` `0.84.1`
- License: MIT, preserved at `LICENSES/pi-coding-agent-MIT.txt`

The fetched release binary and required runtime assets are verified by the
archive SHA-256 and pinned per-file SHA-256 values in `scripts/dev/`.

JavaScript and Rust dependencies retain the licenses declared by their
respective packages.
