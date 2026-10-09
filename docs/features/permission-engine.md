# Permission engine

Every tool call is judged by what it would do and where, and a kept answer says exactly that: an action or a command, a place, how far below it, for how long. An answer of "allow this command for the session" says nothing about where the command runs, so it is never offered.

## Effects

Each call becomes a list of effects. An effect is an action and a place.

- **read**: a file or a directory is read.
- **write**: a file is created or its content changed. An edit through the file tools is a write, with its diff shown.
- **destroy**: content is gone and nothing on the line brings it back: deleting a file or directory, `>` onto a file that exists, `mv` or `cp` onto a file that exists, discarding uncommitted work, rewriting pushed history.
- **runs**: the call is handed a program decided at the time it runs (`find -exec`, sed's `e`, `rg --pre`, a command word from `$(...)`).
- **reaches**: the call touches something no folder stands for: the network, a git remote, the machine's own configuration.

A place is a path, or unknown when the line does not settle it: a variable (`$T`), another command's output, `xargs` input, or a relative path after a `cd` that could not be followed.

A command that names no path has the directory the shell stands in as its place. A call with no effects runs unasked.

## Classifiers

Every known command and every tool has a classifier of its own. It reads the call's arguments and returns either the effects or a refusal. It never sees a kept answer: one evaluator applies those, so a classifier that forgets a rule cannot open a way around it.

A classifier gets facts, not rules: where the shell stands, the home folder, whether a path exists, whether the session created a file in this session.

It also returns the call in a canonical form: the command and its subcommand, its flags under their long names (`-rf`, `-fr` and `--force --recursive` are the same call), and its operands. Kept answers match against this form, never against the words as typed. Each classifier owns its own flag aliases, since `-f` is `--force` for `git push` and not for `grep`.

A command without a classifier is one effect, unknown command, and is asked.

| Tool | Effects |
|---|---|
| Read | read the file |
| Glob, Grep | read the directory, and everything below it when the search goes down |
| Edit, Write | write the file |
| RunScript | one effect per staged change: write, destroy or read |
| An MCP tool | unknown command, unless the tool declares it only reads |

### Writes that bypass the file tools are refused

A shell command that writes text the model wrote itself is refused, and the model is told to use Edit, Write or RunScript instead: `sed -i`, `perl -pi`, `awk -i inplace`, a heredoc or `echo` into a file, `tee`, an inline Python or Node script that writes, PowerShell `Set-Content`. The file tools show the change as a diff, refuse a file the session has not read, and record the change; a regex in a prompt shows none of that.

A program's own output written to a file is not refused: `cargo test > .kiwi/scratch/out.log` and a build writing `dist/` are judged as a write or a destroy at their target.

Wherever a session has a shell it also has the file tools, so this refusal never leaves it without a way to write.

## The shell line

A line is split into its simple commands before any classifier sees it. Redirects become writes or destroys at their target, wrappers (`timeout`, `env`, `xargs`) are judged by the command they run, and a command fed its arguments by another is judged as though they could name any file.

### Where the shell stands

`cd` is not a permission. It moves the tracked directory and runs unasked, except into a directory with a kept read denial, which refuses the whole line: running the rest from the old directory would touch other files than the line names.

The tracked directory carries from one call to the next, since the shell keeps it between calls.

| Form | Tracked directory |
|---|---|
| `cd <path>`, `cd ~/...`, `pushd`, `popd`, `cd -` | followed |
| `cd $X`, `cd $(...)` | unknown |
| `cd` after `\|\|`, after `;` following a command that may fail, inside a loop | one of several; a path must hold from each |
| `(cd x && make)`, a `cd` inside a pipe | unchanged after it |

An unknown directory stays unknown until a `cd` to a place the line names. Every relative path and every pathless command in it has an unknown place.

## Kept answers

A kept answer is:

- **verdict**: allow or deny.
- **what**: an action (read or write), or a command with optional flags.
- **place**: a path.
- **reach**: the file alone, the directory alone, or the directory and everything below it.
- **scope**: this session, the workspace or the person. The scope is where the answer is stored, not a field in it: the workspace's settings, the person's own settings, or the session's memory. A grant one person gave never travels with the source.

```jsonc
"kiwiAgent.permissions.grants": [
  { "verdict": "allow", "action": "read",  "place": "~/.cargo/registry", "reach": "tree" },
  { "verdict": "deny",  "action": "write", "place": "D:/data/raw",       "reach": "tree" },
  { "verdict": "allow", "command": ["git"],         "place": "D:/src/x", "reach": "tree" },
  { "verdict": "deny",  "command": ["git", "push"], "flags": ["--force"], "place": "D:/src/x", "reach": "tree" }
]
```

An action answer names no tool: a read granted in a folder covers `grep -rn` in the shell and the Read tool alike. A command answer is needed only for what a place cannot express.

A command answer matches when the command and subcommand match and the call has every flag the answer names, in any order or form. Flags are offered on a deny only; an allow kept with exact flags breaks on the next call written differently.

### How answers combine

- A call passes when every one of its effects is covered.
- A denial wins over an allow whenever both match, whatever scope either is kept in. An exception is written as a narrower deny, never as an allow beating a deny.
- A read denial refuses writes there too; a write denial still lets the folder be read.
- The workspace folder is ground the session stands on: reads there pass unasked.

### Never kept

These are answered for this call alone. Only a denial of them may be kept.

- A destroy, wherever it lands.
- A runs effect.
- An effect whose place is unknown.

Two kinds of destroy lose nothing and are not asked every time:

- One in the session's scratch folder, or at a path the repository ignores, is judged as a write there.
- A delete inside the workspace runs unasked while Allow writes is on and git can bring back everything it removes (tracked and unchanged, nothing untracked below it). Deleting untracked or changed work is still asked.

### Always asked

Whatever any kept answer or the Allow writes setting says:

- A write to a file that decides what runs without asking: the root `package.json`, `.vscode/settings.json`, `.mcp.json`, a root `.code-workspace`, and the workspace's and the person's permission settings.

### Fixed ground

- The session's own instructions (skills and the files they ship, sub agent definitions, memory notes, the person's `AGENTS.md`) are read unasked wherever they live. Writing there is a write like any other.
- Commands the project defines in its root `package.json` scripts run unasked.
- While git writes are denied for the workspace, every git command that is not read-only is refused.

### Which scopes a place may be kept for

- A place inside one of the workspace's repositories: this session or the workspace. Kept for the person it would say nothing in any other workspace.
- A place outside them, another checkout on the machine among them: this session or the person.

## The prompt

What an answer means is spelled out before it is given. The card shows the sentence the answer will be kept as, built from the parts the person picks, and the same sentence is shown wherever that answer appears again: the Permissions settings list, the phone and the exported transcript.

```
cargo build --release   in D:/src/other
Writes D:/src/other/target   ·   asked because: outside the workspace

  (•) Allow this call only
  ( ) Allow and keep:
        [cargo build ▾]  [any flags ▾]
        writing in  [D:/src/other ▾]  [and everything below ▾]
        for  [every workspace (you) ▾]
  ( ) Deny this call only
  ( ) Deny and keep: ...the same parts...

  From now on, every session in every workspace may run cargo build,
  with any flags, writing in D:/src/other and every folder below it,
  without asking.
  [ Allow and keep ]
```

- This call only is pre-selected, so the quick answer stays one click.
- The confirm button repeats the verb of the sentence.
- The parts offer only what the place allows: no "every workspace" inside a repository, no "workspace" outside it, flags on a deny only.
- Where an effect cannot be kept, the keep options are absent and one line says why: "Deletes files: always asked.", "`$T` could be any folder, so this can only be answered for this call."
- A kept answer already in force is said: "A deny you kept on D:/src/other already refuses writes here; allowing this call won't change it."
- A write shows its diff above the answer. A file tool's card has no command part; its sentence starts at the action.

### A line with several effects

```
cd ~/data && sort raw.csv | uniq > ../out/clean.csv && rm raw.csv

Reads   ~/data/raw.csv     ✓ already allowed (read ~/data, you)
Writes  ~/out/clean.csv    ( ) this call  ( ) keep…      no grant here
Deletes ~/data/raw.csv     ( ) this call only            always asked
```

- One card per line, one row per effect. Rows that already pass are shown collapsed, so the whole line is in view.
- The same action on the same place is one row, however many commands do it.
- Each asked row has its own answer and sentence; the card has one confirm.
- The line runs only when every row is allowed. Denying any row refuses the whole line, and the confirm button says so.
- Kept answers are saved when the card is confirmed, even when the line is refused, and the row's sentence says so.

### Refused without a card

- A line with a refused command (a write that bypasses the file tools).
- A line that hits a kept denial, a `cd` into a read-denied directory among them.

The model is told which command or which kept answer refused it, and what to use instead where there is an alternative.

## What changes for someone using it today

- A change of directory is no longer asked about or kept. A folder is readable through a read grant, not through being allowed to stand in it.
- Answers kept as a command prefix with flags (`grep -n:*`) are no longer matched as words.
- `sed -i` and other in-place edits from the shell are refused rather than asked.
- Overwriting, and deleting what git cannot bring back, is asked every time.
- Writes inside the workspace still follow the Allow writes setting.
- Answers kept in the old form that grant reading or writing a directory become grants once; command prefixes and `cd` answers are dropped and asked again.
- The Claude engine's own `permissions.allow` and `permissions.deny`, in the workspace's `.claude/settings.json` and `settings.local.json` and in the person's `~/.claude/settings.json`, are read as kept answers of the scope each lives in, where they name a command and subcommand, a tool, or a path. An allow naming a flag, or more words than a command and its subcommand, is ignored, since read as a grant it would allow more than it says.
- The Claude engine reports where its shell stands with every call, so a call is judged from there; the own loop's shell always starts in the workspace.

## Not included

- Allows that beat a narrower deny.
- Kept answers that match a command's operands.
- Answers kept as a pattern standing for more than one folder or file.
