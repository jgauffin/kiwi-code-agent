# MCP servers

The workspace's `.mcp.json` (Claude Code's format: `mcpServers` by name, `command`/`args`/`env` for a stdio server, `type` `sse`, `http` or `streamable-http` with `url` and `headers` for a remote one, `${VAR}` and `${VAR:-default}` expanded from the environment) gives every chat session its servers' tools, on both engines.

- Claude engine: the servers are handed to the engine per session, beside the extension's own in-process server; the engine's own reading of the file is turned off so one set is in force.
- Own-loop engine: a client per server per session; a server's tools join the loop's tool list under the server's own JSON schemas.
- Tools are `mcp__<server>__<tool>` on both engines. Every one asks before it runs unless a permission rule names it or its server: `mcp__<server>__*`. A server's read-only annotation is not trusted.
- Saving `.mcp.json` hands the new set to every running session: removed servers are disconnected, new ones connected. A file that does not parse leaves the last set in force and says why.
- *KiwiAgent: Reload MCP Servers* re-reads the file and tries every server in every running session again.
- The composer shows the active session's servers with their status; a failed one carries the error and a reconnect button.
- A stdio server's stderr goes to the KiwiAgent output channel.

Not included: phase sessions (plan, implement, reconcile, cleanup keep their tool lists), an MCP tab in the settings page, OAuth, per-tool policies, servers from the user's own Claude configuration.
