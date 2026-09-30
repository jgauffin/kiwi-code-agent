# Changelog

## Unreleased

- MCP servers can be set for the user in `~/.mcp.json`, with the workspace's `.mcp.json` over it; Claude Code's user-wide list, which it keeps in `~/.claude.json`, is copied there on first run.

## 0.2.1

- Conversations compact at 700k tokens by default (`kiwiAgent.compactAtTokens`), even when the window holds more; a provider can set its own limit per model.
- The Claude engine compacts under KiwiAgent's control instead of its own auto-compaction, and a failed compaction fails the turn instead of overflowing.
- A feature's plan can pick its own profile per step (plan, reconcile, implement, cleanup).
- The spec check records the files each scenario builds on, so the implementer starts there instead of searching.
- Each step runs at a suggested effort (plan and reconcile high, implement medium, cleanup low), and a profile can set a step's effort without changing its model.
- A run fixing a failed test sweep is a step of its own, one effort level higher for each sweep in a row that failed.
- OpenAI-compatible providers send effort as `reasoning_effort` where the endpoint takes it: declared on the provider, or known for the model.

## 0.2.0

Bug fixes across sessions, plans, the chat view and the OpenAI-compatible engine.

## 0.1.0

First public release. Windows (x64, arm64).
