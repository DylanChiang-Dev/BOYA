# runtime/opencode-profile

The Boya Desktop **OpenCode profile** - the config and skills the app ships and applies
to the bundled OpenCode runtime (not a user's global OpenCode).

The desktop app runs OpenCode with an app-private config/data dir (isolated via
`XDG_CONFIG_HOME`/`XDG_DATA_HOME`), so nothing here touches `~/.config/opencode`.

## Contents (planned)

```text
opencode.json      # base config applied to the bundled runtime (providers, defaults)
skills/            # Boya research skills (Markdown, agentskills.io format)
agents/            # optional custom agents
```

## How it maps at runtime

- The user's provider key (from Settings) is merged into the app-private `opencode.json`
  by the `configure_opencode` Rust command; the sidecar is restarted to pick it up.
- Skills are not shipped from here: the pinned Boya pack and curated utility packs live in
  `runtime/skills/external/` (fetched by `scripts/dev/fetch-skills.sh`) and is
  deployed by `runtime.rs` into this profile's global skills dir
  (`<xdg-config>/opencode/skills/`). They appear on the app's Skills page
  (which lists OpenCode's real `GET /api/skill?directory=<workspace>`).

Keep this bundle versioned with the app; it must not carry the user's own keys or sessions.
