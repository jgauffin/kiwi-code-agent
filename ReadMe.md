# KiwiAgent

VS Code extension that runs coding sessions with a choice of engine per session.

- **Claude**: the Agent SDK's JavaScript build of Claude Code (`dist/cli.mjs`), spawned under Node with the login Claude Code already has. No native binary.
- **GLM-5.3-Flash / Kimi K3** through Berget AI: own loop, own tools. Not built yet, see `docs/intent/agent.md`.

The three-phase design (blind plan, reconcile, implement) is the goal; `docs/intent/agent.md` is the definition, the chat agent is the first slice.

## Develop

```
npm install
npm test          # no network or engine needed
npm run build     # dist/: extension, webview, cli.mjs, ripgrep
```

F5 launches the Extension Development Host. Open the "KiwiAgent" view in the activity bar.

## Install elsewhere

```
npm run package   # kiwi-agent-<version>.vsix
code --install-extension kiwi-agent-<version>.vsix
```

Requires Node in the environment only if `kiwiAgent.nodePath` is set; otherwise VS Code's own executable runs the engine in Node mode.

## Settings

- `kiwiAgent.profiles`: engine, model, effort per selectable profile.
- `kiwiAgent.nodePath`: Node executable for the Claude engine; empty uses VS Code's executable.
- Command *KiwiAgent: Set API Key for Profile* stores keys for profiles that declare `apiKeySecret`.

Session events are logged to `.agent/runs/<session id>/events.jsonl` in the workspace; add `.agent/` to the workspace's `.gitignore`.
