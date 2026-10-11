# Changelog

## 0.2.8

- Specs can be filed in folders at any depth (`specs/orders/returns/`); planning and Clean up docs propose and write nested folders too.
- Clean up docs can file drafts in folders and offers to sort existing specs even when every spec sits at the root; only `kiwiAgent.specFolders: flat` keeps it flat.
- New session: filter the specs to pick up by name or folder, and tick "Not done" to hide verified ones.
- New session: Ctrl+click or middle-click a spec to open it in a tab of its own while you stay on the current one, so you can open several from one screen.
- Picking a verified feature whose spec gained rules, or whose board gained a task, now opens it with the unbuilt rules named instead of refusing it as done.
- Approving a revised spec of a feature built on an older task board now builds the rules it added instead of skipping the implementation.
- Cleanup no longer splits a class into partial classes or files that reopen it; it extracts each responsibility into a module or class of its own.
- MCP servers start on the first call to one of their tools instead of with every session; under the composer each server shows a light (green running, red not running) and a click starts or stops it.

- Permission prompts list what the call would do, one row per effect, and show the sentence an answer is kept as (who, what, where, how far below) before you confirm; the Permissions settings page lists kept answers the same way.
- Permission prompts show one line per asked effect with one Allow and one Deny; "Allow reads in this folder…" on a line keeps the answer for the folder.
- A read another line already covers is no longer asked twice.
- Sessions use their scratch folder for output and data files, and do computation in RunScript instead of writing a script and asking to run it.
- A session's scratch folder is named by the first 8 characters of its id (`.kiwi/scratch/a09d1305`); folders of earlier sessions keep their full names.
- A path the command line first sets in a variable (`S=.kiwi/scratch/x; npm test > $S/out.log`) is judged as that path instead of always being asked.
- `wc -c`, `cat -n`, `tail -f` and `stat -f` on a file outside the project are now asked about.
- A folder outside the workspace can be kept for "this workspace"; it is saved in `~/.kiwi/permissions.json`, tied to the workspace.
- Grep with a `glob` like `{a,b}/docs/**` asks only for those folders.
- A brace in a Glob pattern or shell path no longer slips past a prompt.
- `Exists` is allowed wherever reading that folder is.
- Permission prompts show a tool's arguments as labelled fields instead of JSON.
- An open permission prompt stays at the bottom of the chat; clicking "Waiting for you to allow or deny" scrolls to it.
- Answering a prompt the engine had already withdrawn no longer does nothing; the answer goes to the model.
- `ToolSearch`, `ListAgents`, `SendMessage`, `ScheduleWakeup`, the task tools and starting a subagent no longer ask for permission; the subagent's own calls still do.
- A command run in the workspace is answered with Allow once, Allow for this session, Allow for this workspace or Deny.
- Writing memory notes (`~/.claude/projects/<workspace>/memory/`, your personal memory file) no longer asks.
- A subagent's permission prompt unfolds its step so you see it; a prompt left open when the session stopped no longer shows as "Waiting for you".
- Answers are kept as `kiwiAgent.permissions.grants`; old `permissions.allow`/`deny` entries granting a folder are converted on start, and command-prefix and `cd` answers are dropped and asked again.
- Deleting or overwriting is asked every time, except in the scratch folder, in ignored output, or (with Allow writes on) where git can bring it back.
- `cd` no longer asks; commands after it are judged from where it lands, and the Claude engine's real shell directory is used across calls.
- `sed -i`, `perl -pi`, `tee`, `echo > file` and heredocs into a file are refused with a pointer to Edit, Write or RunScript.
- The Claude engine's own `permissions` rules in `.claude/settings*.json` and `~/.claude/settings.json` are honoured as kept answers, and can no longer let a call past a prompt on their own.
- A folder you allowed for writing can now also be read unasked, and a folder you denied for reading or for changing into refuses reads and writes below it, in shell commands and file tools alike.
- Every permission prompt now offers "Allow" for this call alone beside any remembered-rule button, pre-selected so a plain Allow or Enter settles it without picking a scope. A copy or move command lists what it reads from and what it writes to, and marks whichever one is why it is asking.
- A rule about a folder or a file outside every one of your repositories (a `cd` into it, or a shell command that writes to it) can now be kept for you rather than for one workspace, so granting it once covers every project that reaches the same ground. The Permissions settings page has a new "For you, in every workspace" section listing what you have kept, in a file of your own (`~/.kiwi/permissions.json`); a write there is always asked, the way a write to a workspace's own settings already is.
- A provider can now run the Claude Code installed on your own machine instead of the one bundled with the extension, which is how you reach a model the bundled engine refuses: Opus 5.5 and Sonnet 5.5 need a Claude Code newer than it. Pick *Claude (the Claude Code installed on this machine)* as a provider's engine and list the models that install serves. It is offered once a Claude Code is found on PATH, in your home folder, or at the path you name in `kiwiAgent.claudeCodePath`, and it runs on the same Claude login, tools, skills and permissions as the bundled engine.
- Where that install can run newer models than your profiles do, the newer ones are offered: once as a notification, and on the Models settings page until you take it or turn it down. Taking it adds the provider on that install and points your profiles at Opus 5.5 or Sonnet 5.5, leaving what you ran before configured so you can switch back.
- A read or a write outside the project, by a shell command or a file tool, is now asked about as the directory it reaches and whether it reads there or writes there, with the full path shown and the choice of how far up to keep the answer. Commands are no longer offered as the thing to remember for such calls, and a path that depends on a variable or an earlier `cd` that may not have run is asked every time.
- Sessions that write code or docs no longer cite specs in them: only a spec cites the docs, so a renamed or moved spec leaves no stale reference behind.
- The agent no longer rewrites files from the shell (`sed -i`, `awk -i inplace`, or output written to a temporary file and moved back): it makes the change with Edit, or with RunScript when more than two lines change, so it reaches you as a diff and other sessions see it.
- A copy button on each message in the conversation, on hover: it puts the message on the clipboard as the Markdown it was written in, not as the formatted text you see.
- Reading outside the project is now asked for, the way writing already was: a session reads, lists and searches freely inside the project, and a file anywhere else — your keys, another workspace, the rest of the disk — needs your say-so once, by allowing that call or that folder.
- Loading a skill, and reading the files it ships, no longer asks: a session reads its own instructions — skills, sub agent definitions, memory notes, your `AGENTS.md` — without a prompt wherever they are kept. Writing there still asks.
- A command that only inspects is judged by where it reads: `cat ../other/.env`, `grep -rn secret /`, `git -C ../other log` and `cat < ../other/.env` all ask, while `echo`, `basename` and a `grep` pattern that merely looks like a path do not.
- After `cd sub/folder &&`, the paths a command names are read from that folder, so `cd src && ls ../tests` no longer asks as if it left the project.
- A `cd` outside the project asks about the directory, never `cd` itself: click a part of its path to choose how far up the grant reaches. `~` is your home folder, which is never offered; `cd -` and `$VAR` targets ask every time.
- A command fed its arguments by `xargs` now asks, unless no argument could make it touch a file.
- CodeOutline gives each file's length in lines, so a session sizes up the code without a `find | xargs wc -l` that would stop for a prompt.
- Picking a built feature whose spec you have edited back to draft no longer just reopens its planning tab on the old conversation: the planner names the rules nothing on the task board builds yet, weighs whether they make sense, and plans them before writing anything.
- Feature planning refuses a name another feature already holds, naming that feature and pointing you at picking it up or *Update spec*, instead of quietly starting a second planning session inside the first one's tab and over its spec.
- The plan bar no longer offers *Continue implementing* in the moment between two tasks: while the build hands one task's run over to the next it keeps showing the board's progress, and the button comes back only when the build really has stopped on you.
- *Suggest a name* on the Feature planning card: describe the feature and the model names it for you, clear of the names already taken. The name lands in the field as yours to keep or edit.
- The Decisions tab's "waiting for the planner to propose" now pulses, so it reads as something still happening.
- A reopened conversation no longer says "Waiting on model" when nothing is running.
- Subagents running at the same time no longer mix their text into each other's messages.
- Each subagent's messages and steps are tagged with the agent they came from.
- A permission prompt raised inside a subagent now appears in that agent's step.
- The activity row stays on the step the main thread waits on instead of flickering between subagents.
- While Claude Code starts your MCP servers, the activity row says "Connecting the MCP servers" rather than an earlier start-up step.
- A session on an OpenAI-compatible endpoint that may read the code can now delegate a self-contained task to a sub agent through a new `Delegate` tool: the built-in quote-only lookup, one defined under `.claude/agents` or `.kiwi/agents` (person or workspace, alongside skills), or one described in the call itself.
- A toggle beside *Approve*, `kiwiAgent.startBuildOnApproval`: off, an approved feature is checked and mapped and then waits for *Implement*.
- A task run is told which of its mapped files another hand changed since the check, with the line ranges.
- A chat session checks what it coded against the specs and names the ones that need updating.
- A script's `replace` no longer needs the agent to have read each file first, so sweeping a rename across many files costs one script instead of a read per file; the diff of what was written comes back to the agent to check. `write` and `edit` inside a script, whose text is the agent's own rather than the file's, still need the file read.
- A delegation can set a budget (tool calls, tokens) and what it wants back; a sub agent that runs out of budget reports what it found so far instead of failing. The transcript shows a delegation as one row naming the task, its status and what it spent, expanding to the sub agent's own messages and tool calls. A sub agent's spend counts toward the session's own totals, and interrupting the session ends every delegation in flight. A defined sub agent can name its own model in its frontmatter; the built-in one runs on the active profile's own entry for it.
- Feature planning can now research the open internet through a `research` sub agent: it searches and fetches, and answers in verbatim excerpts with where each came from rather than a summary. Approving the delegation approves the whole research, with no further prompt per page; an allow rule for `Delegate` lets a workspace skip that prompt too. A new "Search provider key" field under Advanced settings holds the Brave Search API key it searches with.

## 0.2.7

- New *Update spec* card on the new-session screen's Code tab: pick any feature's spec, whatever its state, describe what should change, and it starts that change, whether or not the feature has anything open.
- *Update spec*'s direction answers every part of what you described, leaves a rule it doesn't reach exactly as it stands, and names which feature owns it when what you asked for is behaviour another spec already defines.
- Change and *Update spec* always plan, never land in whatever cleanup, build or check conversation a feature's tab happens to show: a cleanup offer not yet settled is dropped rather than split over code about to be rewritten, and the plan bar stands at Plan from the moment you ask.
- A session takes a column out of a command's output with `tr`, `cut`, `sort`, `uniq` or `jq`, which run without a prompt, instead of reaching for awk and asking you every time.
- A `sed` call runs without a prompt only where its script plainly just prints: an address with `p`, `d`, `q` or `=`, or one `s///`. Every other script asks, `-f` among them, since sed's own `e` runs a shell command and `w` writes any path.
- A task button in the implementation switcher carries its state as a colour: grey waiting, blue being built, green done.
- A spec opens in its planner from the file itself: *Open In Planner* on the explorer's right-click menu for any spec, and a button in the editor's title bar while the spec is still a draft.
- Each spec in the file explorer carries where it stands as a symbol, with the full word on hover: ✎ draft, ⚑ approved, ⚙ implemented, ✅ verified. The file name's colour is left to git.
- New Remote tab in Settings: pair a phone with this workspace by a code shown as text and as a QR code, list paired phones by name and last connection, and unpair one. Behind `kiwiAgent.remoteControl.enabled`, off by default.
- New *Push by default* setting in the Remote tab: whether a session started at the desk pushes to paired phones when it stops on a question or a permission prompt, until you turn it off for that session; one started from the phone always pushes. On by default.
- A permission prompt names the subcommand even when the tool's own options stand before it: `npx --prefix web tsc` is remembered as that, not as every use of `npx`.
- The plan bar says when the planner is at work on a draft, beside Approve, which is greyed while it works but still yours to press.
- Picking up a draft opens its chat and leaves you there when the critique lands, so what the planner makes of the draft is read before the spec.
- Notes typed on the new-session card survive picking a plan up from the same screen: they are said in that plan's chat as your own message instead of being lost with the card.
- New `spec-writing-from-code` skill: drafts specs by reading the source, for a codebase with nothing written down, and flags what it had to guess.
- A tab stopped on an open question or a permission prompt fades its icon in and out, so it shows while you are on another tab.
- A chat session's effort sits beside its model in the composer, switchable between turns the same way: pick how hard the model thinks, or leave it at the model's own default. The switch only appears for a model whose levels are known (Claude, and an OpenAI-compatible model that takes `reasoning_effort`), and a level you picked survives a model switch, brought down to what the new model takes.
- *Evaluate docs* and *Doc migration* are one job, *Clean up docs*; it can also change the README. A profile's model for *Evaluate docs* is dropped.
- A task run starts from the files its task names instead of working the surface out again: it opens those and the task's context first, searches only for what they leave open, and no longer sweeps the other features' specs or the docs before writing anything.

## 0.2.6

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
- Cleanup no longer flags long files in languages it can't read, such as SQL migrations, YAML or JSON.
- The Cleanup tab is there as soon as the tests pass, and the Tasks tab hands over to it when they do; a tab you opened yourself is left where it is.
- A draft on the pick-up list says how it came to be (planned with you, drafted from the docs, or hand-written) and how far its review got.
- The Sessions view's *Open Draft Plan* now opens the feature's planning session on a draft with no session of its own yet, instead of opening the spec file in an editor tab.
- Picking a draft up with no session of its own buys a critique in chat before any write, sized to how the draft was authored, and answers a review already waiting on it before raising anything of its own.
- A draft's critique names every other draft whose rules describe the same behaviour and proposes which feature should own it; it writes only its own spec, and the user's ruling on ownership is recorded for the other draft to pick up.
- A draft's critique can propose a different direction than the one the draft takes, leaving the spec untouched until you choose; taking it rewrites the same spec file, keeping the draft's direction carries it on as it stands without raising the same redirect again.
- A paired phone can answer a question or a permission prompt, send a running session a prompt or interrupt it, approve a spec and send its rulings, and pick up a draft's planning session; whichever device answers first wins, and every act from the phone is logged as having come from there.

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
