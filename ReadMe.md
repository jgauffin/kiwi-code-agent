# KiwiAgent

VS Code extension that runs coding sessions with a choice of engine per session.

- **Claude**: the Agent SDK's JavaScript build of Claude Code (`dist/cli.mjs`), spawned under Node with the login Claude Code already has. No native binary. Gets the extension's own tools (JsonSchema, JsonQuery) through an in-process MCP server, shown under their bare names.
- **GLM-5.3-Flash / Kimi K3** through Berget AI (OpenAI-compatible): own loop with Read, Write, Edit, Glob, Grep, JsonSchema, JsonQuery and Bash. The JSON tools stream a file and return its shape or the rows an expression selects, so a large JSON file never has to be read whole. Read-only tools run without asking; the rest prompt, with "always allow" per tool and session. Needs an API key: run *KiwiAgent: Set API Key for Profile*.

The three-phase design (blind plan, map against code, implement) is the goal; `docs/intent/agent.md` is the definition.

The sidebar has a Sessions view (every session, with status) and the Chat view: tabs for the sessions in play with a status icon (📐 planning, 🔧 implementing, ✋ needs you, ⚠ error, ○ waiting), a `+` tab that opens the new-session screen, then the transcript. The model comes from settings (`kiwiAgent.activeProfile`, `kiwiAgent.planProfile`), not from the UI.

Session modes:

- **Chat**: work in the code with the full tool set.
- **Plan**: blind planning of one feature. The session can read `docs/intent/**` only, enforced at the tool call, and writes `plan/<feature>.spec.md` (goal, behaviour, edge cases, open questions, stable item ids, `status: draft`). The first prompt is the feature or user story description. Writing the spec needs no permission prompt. A bar above the transcript switches between the plan (Plan) and the conversation (Chat), names the feature's stage and offers the next step; the view follows the work: Chat while the planner responds, Plan when its turn ends.

The Plan view follows the stage: comment on and strike the spec's items while it is a draft; once the review is closed (or from the bar) the spec is mapped against the code, which writes findings into the spec and `plan/<feature>.tasks.md` with the files each task touches; Approve sets `status: approved`; Implement works the tasks and marks each `[in progress]`, `[done]`, `[tested]` or `[blocked: reason]` in the tasks file, which the view shows; once every task is tested the `kiwiAgent.verify` test commands run over the tasks' files and the outcome is recorded in the tasks file.

## Develop

```
npm install
npm test          # no network or engine needed
npm run build     # dist/: extension, webview, cli.mjs, ripgrep
```

F5 launches the Extension Development Host. Open the "KiwiAgent" view in the activity bar.

## Develop with it

Load the extension from this repo in your normal VS Code instead of a packaged copy:

```
npm run link-dev   # installs the .vsix so VS Code registers it, then points the installed folder at this repo
```

Reload the window once. From then on, after `npm run build` (or the `npm: watch` task) the extension notices its own bundle changed and offers "Reload Window". Sessions and the open session survive the reload; engines resume on the next prompt. `npm run unlink-dev` removes the link.

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
- `kiwiAgent.traceEngine`: one line per Claude engine message in the KiwiAgent output channel, to see what the engine sends (thinking deltas, status) when the UI shows nothing.
- `kiwiAgent.verify`: test commands run once every task of a feature is marked tested, over the files the tasks name, in the directory of the nearest `project` file; a repo with a backend and a frontend runs each suite once, and only the suites the feature touched. A failure is handed to the implement session, up to `kiwiAgent.verifyFailureBudget` consecutive failures. Default: `dotnet test` of the `.csproj` owning a `.cs` file, `npm test` in the `package.json` folder owning a `.ts` file.
- Command *KiwiAgent: Set API Key for Profile* stores keys for profiles that declare `apiKeySecret`.

Session events are logged to `.agent/runs/<session id>/events.jsonl` in the workspace; add `.agent/` to the workspace's `.gitignore`.
