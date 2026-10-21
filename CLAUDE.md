# Better Stack plugin

## Releases: one version across the three plugins

The Claude ([BetterStackHQ/claude-plugin](https://github.com/BetterStackHQ/claude-plugin)), Codex ([BetterStackHQ/codex-plugin](https://github.com/BetterStackHQ/codex-plugin)) and Cursor ([BetterStackHQ/cursor-plugin](https://github.com/BetterStackHQ/cursor-plugin)) plugins always release with the same version number. A change that bumps one plugin's version bumps all three to that same new version, in PRs opened together, even when the other two have nothing else to change.

The version is set in:

- Claude: `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json`
- Codex: `.codex-plugin/plugin.json`
- Cursor: `.cursor-plugin/plugin.json`

Before you open a release PR, check that all three files show the same version.
