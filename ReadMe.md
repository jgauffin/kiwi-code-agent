# KiwiCodeAgent

![A mad motha f00ker bird logo for them to see](/docs/kiwi-bird-320.png)

***still early, nothing to try yet***

VS Code extension that runs coding sessions with a choice of engine per session:

- **Claude**: the Agent SDK's JavaScript build of Claude Code, spawned under Node with the login Claude Code already has. No native binary.
- **Any OpenAI-compatible endpoint** (tested with GLM-5.3-Flash and Kimi K3 through Berget AI): own loop with Read, Write, Edit, Glob, Grep, JsonSchema, JsonQuery and Bash. Read-only tools run without asking; the rest prompt, a shell call command by command.

Both engines get the workspace's `.mcp.json` servers and the extension's JSON tools, which stream a file and return its shape or the rows an expression selects, so a large JSON file never has to be read whole.

Three session modes:

- **Chat**: work in the code with the full tool set.
- **Plan**: blind planning of one feature. The planner reads docs and earlier specs, never the code, and writes a spec of named rules; the spec is then mapped against the code, every disagreement is ruled on by you, and the tasks are implemented and verified by the test suite. See [docs/plan-sessions.md](docs/plan-sessions.md); `docs/intent/agent.md` says why.
- **Evaluate docs**: the docs decide how good a blind plan can be, so this reads them as the planner does and says where their arrangement would cost one, then changes what you pick, one confirmed write at a time.

A planner starts with a generated map of the docs: every doc, what it is for, and one line per heading, so it opens one file instead of the tree and cites the heading exactly. Only the docs that changed are re-read when the map is rebuilt.

## Get started

```
npm install
npm run package   # kiwi-agent-<version>.vsix
code --install-extension kiwi-agent-<version>.vsix
```

Open the "KiwiAgent" view in the activity bar. The Sessions view lists every session with its status; the Chat view has a tab per session and a `+` tab for a new one, which picks the model. The gear opens the settings page.

Claude works with the login Claude Code already has. For another endpoint, add a profile with `baseUrl`, `model` and `apiKeySecret` on the Models tab, then run *KiwiAgent: Set API Key for Profile*. Node is needed only if `kiwiAgent.nodePath` is set; otherwise VS Code's own executable runs the engine.

## More

- [docs/settings.md](docs/settings.md): every setting, MCP servers, logs.
- [docs/plan-sessions.md](docs/plan-sessions.md): the plan workflow in detail.
- [docs/developing.md](docs/developing.md): build, test, run the working copy as the installed extension.
- [docs/features/](docs/features/README.md): what is left to build.
