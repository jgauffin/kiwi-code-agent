# KiwiAgent

VS Code extension that runs coding sessions with a choice of engine per session.

- **Claude**: the Agent SDK's JavaScript build of Claude Code (`dist/cli.mjs`), spawned under Node with the login Claude Code already has. No native binary.
- **GLM-5.3-Flash / Kimi K3** through Berget AI (OpenAI-compatible): own loop with Read, Write, Edit, Glob, Grep and Bash. Read-only tools run without asking; the rest prompt, with "always allow" per tool and session. Needs an API key: run *KiwiAgent: Set API Key for Profile*.

The three-phase design (blind plan, reconcile, implement) is the goal; `docs/intent/agent.md` is the definition.

The sidebar has a Sessions view (every session, with status) and the Chat view: tabs for the sessions in play with a status icon (📐 planning, 🔧 implementing, 🧪 verifying, ✋ needs you, ⚠ error, ○ waiting), a `+` tab that opens the new-session screen, then the transcript. The model comes from settings (`kiwiAgent.activeProfile`, `kiwiAgent.planProfile`), not from the UI.

Session modes:

- **Chat**: work in the code with the full tool set.
- **Plan**: blind planning of one feature. The session can read `docs/intent/**` only, enforced at the tool call, and writes `plan/<feature>.spec.md` (behaviour, invariants, edge cases, acceptance criteria, tasks, open questions, stable item ids, `status: draft`). The first prompt is the feature or user story description.

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

- `kiwiAgent.profiles`: engine, model, effort per profile.
- `kiwiAgent.activeProfile`: profile name used for new sessions; `kiwiAgent.planProfile` overrides it for plan sessions.
- `kiwiAgent.nodePath`: Node executable for the Claude engine; empty uses VS Code's executable.
- `kiwiAgent.verify`: commands run when the model wants to stop after editing matching files, in the directory of the nearest `project` file. Failures go back to the model and it keeps working, up to `kiwiAgent.verifyFailureBudget` consecutive failures. Default: `dotnet build` of the `.csproj` owning any edited `.cs` file. Applies to every engine.
- Command *KiwiAgent: Set API Key for Profile* stores keys for profiles that declare `apiKeySecret`.

Session events are logged to `.agent/runs/<session id>/events.jsonl` in the workspace; add `.agent/` to the workspace's `.gitignore`.
