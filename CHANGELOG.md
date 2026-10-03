# Changelog

## 0.2.6

- A chat session's effort sits beside its model in the composer, switchable between turns the same way: pick how hard the model thinks, or leave it at the model's own default. The switch only appears for a model whose levels are known (Claude, and an OpenAI-compatible model that takes `reasoning_effort`), and a level you picked survives a model switch, brought down to what the new model takes.
- *Evaluate docs* and *Doc migration* are one job, *Clean up docs*; it can also change the README. A profile's model for *Evaluate docs* is dropped.
- A task run starts from the files its task names instead of working the surface out again: it opens those and the task's context first, searches only for what they leave open, and no longer sweeps the other features' specs or the docs before writing anything.
- New `SpecSearch` tool: finds spec rules and returns them whole.
- Future work moves to `specs/future-work.md`; entries marked `built: false` are moved there on startup.
- An approved code plan records its spec changes and decisions before building.
- Writes to the root `package.json`, `.vscode/settings.json` and `.mcp.json` always ask, even with Allow writes on.
- Verify rules take an optional build command, which the implementer runs without a prompt.
- Decision findings describe what the product does, without file or code names.
- Compaction keeps what each session type needs; a task run keeps its task and rules word for word.
- *Pick up where you left off* lists finished plans (marked done), code plans and docs sessions, newest worked in first, and opens a finished plan in its planning session.
- Verify only appears when a test command applies to the feature's files, and its view shows each command, its result and any failure output; a run with nothing to run says no tests ran.
- A blocked task gets one more look, in its own chat, once every other task is done; if it stays blocked, hand it back or accept it as is from the Tasks tab.
- Cleanup can put split-out code in a new file in the folder it belongs in, not only beside its source.

## 0.2.5

- Accepting a newer version of a bundle replaces the skills it installed whole, dropping any file the new version no longer carries; removing a bundle removes its skills the same way. A required bundle's skills are reinstalled if you delete them, and a skill file you edited by hand is called out before an update would overwrite it. A source that can't be reached never touches a skill already installed.
- A bundle's skills install into `.kiwi/skills`: a project-scope bundle commits them with the workspace, a person-scope one puts them under your own profile for every workspace you open. They load on both engines, the same as a skill you wrote yourself; your own skill wins over a bundle's of the same name, and the bundle's is reported as not applied.
- Escape in the prompt box stops the running turn, the same as the Stop button.
- A feature left at `implemented` is offered on the new-session screen as *implemented: ready to verify*, and its plan bar stands on Verify once its working files are swept. Before, a feature built but not yet proven was shown as finished and there was no way back into it.
- A code check can be asked for on a feature that is built but not yet proven; before, only one still waiting to be implemented could be checked.
- An assistant turn that says nothing no longer leaves an empty message in the chat.
- An unfiled decision now says whether the product already works that way, with a `- built: true` or `- built: false` line; an existing entry in `specs/unfiled-decisions.md` needs the line added, and a session that writes an entry without it is told so. *File decisions* files a built decision as a rule, while one still to build goes to the docs as what the product should do and is named as a feature to plan.
- A spec's `status` now says where its feature stands as the work moves: `approved` when you approve it, `implemented` once every task is tested, `verified` once the test commands pass. It used to sit at `approved` until the working files were swept a week later, so a feature that was built and proven still read as work waiting to start. Reopen a task or fail a re-run and the status falls back with the board.
- A spec an earlier version left at `implemented`, its working files already swept, is read as `verified` and rewritten to it on the next start: `implemented` now means built but not yet proven.
- The plan a chat session puts to you when it leaves planning is shown as the plan it wrote, headed *Proceed with this plan?*, instead of the tool's raw arguments. It is answered for that plan alone: the prompt no longer offers to remember the tool, which would have waved the next plan through unread.
- Ticking *Allow writes* while a prompt is waiting answers it, when the switch covers that call: no second click for the write you just allowed.
- A write prompt for a file in the project is Allow or Deny. The *Covers* chooser, which offered the file or its folder as a remembered rule, is gone; *Allow writes* is how you stop being asked.
- A plan session now points you at *Approve plan*, the button that is actually there, instead of a *Continue* that never existed.
- Every session is told the workspace folder it works in and that its shell commands and tool paths already start there, so it stops opening commands with a `cd` to the project root.
- A request the model's API refuses now reports what it refused and why. Before, the session showed *Assistant error: unknown* and then the refusal itself as though the assistant had replied it.
- The extension's working folder is `.kiwi/` instead of `.agent/`, and plans live in `specs/` instead of `plan/`. Your own skills move with it, from `~/.agent/skills` to `~/.kiwi/skills`. A workspace laid out the old way is moved on first run; anything whose new place is already taken stays where it is and is reported.

## 0.2.2

- Renamed to Kiwipow Agent. The Marketplace ID is now `CoderrAB.kiwipow-agent`; uninstall `CoderrAB.kiwi-agent` and install the new one. Settings keep their `kiwiAgent.*` names.
- MCP servers can be set for the user in `~/.mcp.json`, with the workspace's `.mcp.json` over it; Claude Code's user-wide list, which it keeps in `~/.claude.json`, is copied there on first run.
- The cleanup holds a file to the test limits when its name starts or ends with "test" in any case (`FooTests.cs`, `FooTest.java`, `foo_test.go`, `test_foo.py`), not only `*.test.*`.

## 0.2.1

- Conversations compact at 700k tokens by default (`kiwiAgent.compactAtTokens`), even when the window holds more; a provider can set its own limit per model.
- The Claude engine compacts under Kiwipow Agent's control instead of its own auto-compaction, and a failed compaction fails the turn instead of overflowing.
- A feature's plan can pick its own profile per step (plan, reconcile, implement, cleanup).
- The spec check records the files each scenario builds on, so the implementer starts there instead of searching.
- Each step runs at a suggested effort (plan and reconcile high, implement medium, cleanup low), and a profile can set a step's effort without changing its model.
- A run fixing a failed test sweep is a step of its own, one effort level higher for each sweep in a row that failed.
- OpenAI-compatible providers send effort as `reasoning_effort` where the endpoint takes it: declared on the provider, or known for the model.

## 0.2.0

Bug fixes across sessions, plans, the chat view and the OpenAI-compatible engine.

## 0.1.0

First public release. Windows (x64, arm64).
