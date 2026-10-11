---
feature: Permission rules
status: draft
---

# Permission rules

## Goal
A developer works with a session that reaches for the shell and the file tools constantly, and every prompt costs them a glance and a click, while every answer they keep has to mean exactly what they thought it meant. A command is harmless or dangerous by what it does and where, not by its name: the same `cargo build` is routine in the workspace and something to think about in another checkout, and a `rm` is worth a look wherever it lands. So every call is judged as what it would do and where, an answer is kept as an action or a command at a place, for a reach and a scope the person picks, and the prompt shows the sentence the answer will be kept as before it is given.

## What a call would do
Every tool call, and every simple command of a shell line, is judged on its own.
- **Effects of a call**: a call is judged as a list of effects, each a read, a write, a destroy, a program it runs, or a reach beyond files (the network, a git remote, the machine's configuration), at a place, and a call with no effects runs unasked (docs/features/permission-engine.md#Effects)
  - **Unknown place**: a path held in a variable, taken from another command's output or fed in by `xargs` is an unknown place, except a variable the line itself surely set to a plain path earlier and binds nowhere else, which names that path
  - **No path named**: a command that names no path has the directory the shell stands in as its place
  - **A search narrowed by its glob**: a search or a file pattern whose brace alternatives name folders below its path reads only those folders, while a brace in a shell word leaves its place unknown
  - **Whether a path exists**: looking whether a path exists is covered by whatever lets that path be read
- **Destroy is not write**: deleting a file or directory, `>` onto a file that exists, a copy or move onto a file that exists, discarding uncommitted work and rewriting pushed history are destroys, while creating a file, appending and editing through the file tools are writes (docs/features/permission-engine.md#Effects)
- **Flags read as the command means them**: two calls that differ only in how their flags are written (combined, split, short or long, reordered) are judged and matched alike (docs/features/permission-engine.md#Classifiers)
- **Unknown commands are asked**: a command the agent does not know is asked about, and no answer kept for a place lets it through (docs/features/permission-engine.md#Classifiers)
- **One answer per place for every tool**: reading a folder through a shell command and through the file tools is the same effect, covered by the same kept answer (docs/features/permission-engine.md#Kept answers)
- **Writing around the file tools is refused**: a shell command that writes text the model wrote itself (an in-place sed, perl or awk edit, a heredoc or echo into a file, `tee`, an inline script that writes a file) is refused unasked and the model is told to use the file tools instead (docs/features/permission-engine.md#Writes that bypass the file tools are refused)
  - **A program's own output**: a program's output redirected to a file, or a build writing its own output, is judged as a write or a destroy at its target rather than refused

## Where the shell stands
- **Changing directory asks nothing**: a change of directory is not asked about and is never kept; it moves where the commands after it are judged from (docs/features/permission-engine.md#Where the shell stands)
  - **Into a read-denied directory**: a change of directory into a directory kept as denied for reading refuses the whole line
- **The shell's directory carries across calls**: a call is judged from the directory an earlier call left the shell in, as the engine reports it where it does (docs/features/permission-engine.md#Where the shell stands)
- **An untracked directory is an unknown place**: after a change of directory the line does not settle, every relative path and every pathless command has an unknown place until a change of directory to a place the line names (docs/features/permission-engine.md#Where the shell stands)
  - **A move that may not have happened**: after a change of directory under `||`, after one that may fail, or in a loop, a relative path must be covered from every directory the shell may stand in
  - **A subshell or a pipe**: a change of directory inside a subshell or a pipe leaves the directory after it unchanged
- **A line passes only as a whole**: a line runs unasked only when every effect of every command on it is covered (docs/features/permission-engine.md#A line with several effects)

## Keeping an answer
- **What an answer is kept as**: a kept answer is an allow or a deny of an action or a command, at a file or a directory, reaching that file, that directory alone, or that directory and everything below it, for the session, the workspace or the person (docs/features/permission-engine.md#Kept answers)
- **Each scope is kept where it lives**: an answer kept for the workspace is stored with the workspace's settings and one kept for the person with their own, so a grant one person gave never travels with the source (docs/features/permission-engine.md#Kept answers)
- **A command answer matches on command and flags**: a kept command answer covers a call with the same command and subcommand that carries every flag the answer names (docs/features/permission-engine.md#Kept answers)
  - **Flags on a deny only**: an answer naming flags may be kept as a denial, never as an allow
- **A denial wins**: a call matched by both a kept allow and a kept denial is refused, whatever scope either is kept in (docs/features/permission-engine.md#How answers combine)
  - **A read denial refuses writes**: a directory denied for reading refuses writes there too, while one denied only for writing may still be read
- **Reads in the workspace pass**: a read inside the workspace runs unasked (docs/features/permission-engine.md#How answers combine)
- **Workspace writes follow Allow writes**: a write inside the workspace runs unasked while the Allow writes setting is on and is asked while it is off, and a write in the session's scratch folder runs unasked either way (docs/features/permission-engine.md#How answers combine)
- **Never kept as an allow**: a destroy, a program the call runs, and an effect at an unknown place are answered for that call alone, and only a denial of them may be kept (docs/features/permission-engine.md#Never kept)
  - **Throwaway places**: a destroy in the session's scratch folder or at a path the repository ignores is judged as a write there
  - **Recoverable deletes**: while the Allow writes setting is on, deleting inside the workspace runs unasked when git can bring back everything it removes, while deleting untracked or changed work is still asked
- **Answers kept before this change**: an answer kept in the old form that grants reading or writing a directory is read as that kept answer, while one kept for a command prefix or for changing directory is dropped
- **The Claude engines' own rules**: an allow or deny rule in the Claude engine's own settings is read as a kept answer for the scope it lives in where it names a command, a command and subcommand, or a path to read or edit, and is otherwise ignored
  - **A rule naming flags**: an allow rule whose command words include a flag is ignored, since reading it without the flag would allow more than it says
- **Scopes by place**: a place inside one of the workspace's repositories may be kept for the session or the workspace, and a place outside them, another checkout or a folder holding the workspace among them, for the session, the workspace or the person (docs/features/permission-engine.md#Which scopes a place may be kept for)
  - **Outside kept on this machine**: a workspace's answer about a place outside it is kept with the person's own answers, tied to that workspace and honoured there alone, never in the workspace's settings
- **Some targets are always asked**: a write to the root `package.json`, `.vscode/settings.json`, `.mcp.json`, a root `.code-workspace`, or where the workspace's or the person's permission rules are kept is asked whatever any kept answer or the Allow writes setting says (docs/settings.md#Settings)
- **A session's own instructions are its own ground**: reading a skill and the files it ships, a sub agent definition, the memory notes and the person's own rules file runs unasked wherever they live, while a write there is a write like any other (docs/settings.md#Settings)
  - **Memory notes are written unasked**: writing a memory note where the session is told to keep them, the project's memory folder or the person's memory file, runs unasked, while deleting one is still asked
- **Project commands run unasked**: a command the project defines in its root `package.json` scripts runs unasked (docs/features/permission-engine.md#Fixed ground)
- **Git writes can be refused outright**: while git writes are denied for the workspace, every git command that is not read-only is refused whatever any kept answer says (docs/settings.md#Settings)

## Answering a prompt
- **The sentence it will be kept as**: a prompt shows, before it is answered, the sentence the answer will be kept as, and updates it as the person changes what is kept (docs/features/permission-engine.md#The prompt)
- **One sentence everywhere**: a kept answer reads as the same sentence on the prompt, in the Permissions settings list, on a paired phone and in an exported transcript (docs/features/permission-engine.md#The prompt)
- **A command in the workspace is four buttons**: a command run in the workspace is answered once, for the session, for the workspace, or denied, with nothing else to pick, and a kept answer covers the command and its subcommand anywhere in the workspace (docs/features/permission-engine.md#The prompt)
- **This call alone is one click**: every prompt is answered for this call alone by one Allow or one Deny, and the ways an answer may be kept are opened per row only when asked for (docs/features/permission-engine.md#The prompt)
- **Only what the place allows is offered**: a prompt offers only the scopes the place may be kept for, flags only on a denial, and no keeping at all for an effect that is never kept, saying in one line why (docs/features/permission-engine.md#The prompt)
- **What already stands is said**: a prompt names any kept answer that already decides part of the call (docs/features/permission-engine.md#The prompt)
- **A write prompt shows its change**: a write is put to the person as the change it would make rather than as the arguments it was called with (specs/file-edit-diff.spec.md#Behaviour)
- **One row per effect**: a line with several effects is one prompt with one row per effect, effects already covered shown quiet, the same action at the same place shown once, and a place another asked row's answer would always cover not asked beside it (docs/features/permission-engine.md#A line with several effects)
- **Denying refuses the line**: a line runs only when every row is allowed; denying it, or keeping a denial for any row, refuses the whole line, and its confirm says when it will (docs/features/permission-engine.md#A line with several effects)
  - **Kept on a refused line**: answers kept on a prompt are saved when it is confirmed, even when the line is refused
- **Refused without a prompt**: a line with a command that writes around the file tools, or that a kept denial covers, is refused without a prompt and the model is told what refused it (docs/features/permission-engine.md#Refused without a card)
- **Answered away from the desk**: a prompt can be answered from a paired phone with the same effect as at the desk (specs/remote-control.spec.md#Acting from the phone)
