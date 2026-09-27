---
title: A sandbox instead of forty tool calls
published: false
tags: ai, javascript, security, vscode
series: A coding agent that plans blind
---

Ask an agent to rename a function across four hundred files and watch what happens. Four hundred reads, four hundred edits, each one a round trip, each one paying for the file in context, and a conversation you cannot review.

The agent does not need four hundred tool calls. It needs one program.

## The tool

`RunScript` takes the body of an async JavaScript function — `await` and `return` work at the top level — and runs it in a fresh QuickJS realm compiled to WebAssembly. The realm has no Node, no `require`, no `fetch`, no filesystem and no process of its own. There is exactly one way out, and it is a list of functions the host offers:

`read`, `write`, `edit`, `replace`, `preview`, `glob`, `grep`, `bash`, `jsonQuery`, `jsonSchema`.

Those names are built inside the guest from the names the host advertises, so every call crosses the boundary as a name and a string of JSON. The host never touches a guest object.

A rename becomes this:

```js
const files = (await glob({ pattern: 'src/**/*.ts' })).split('\n').filter(Boolean)
let total = 0
for (const f of files) total += (await replace(f, '\\bgetUser\\(', 'fetchUser(')).matches
return `${total} calls in ${files.length} files`
```

One tool call. One line of result. The four hundred files never enter the conversation, because only what the script returns or logs comes back.

## Every call is still gated

The script is not a way around the permission rules. Each `read`, `write`, `edit` or `bash` from inside the sandbox goes through the same gate the model's own tool calls go through, and a denied call throws — the script can catch it and carry on.

So `RunScript` itself needs no permission. It can do nothing on its own. What it can reach is decided one call at a time, exactly as before.

## Edits are staged, and reviewed as one diff

Nothing is written while the script runs. `write`, `edit` and `replace` stage the result in memory, and `read` returns the staged version of a file the script already changed, so a two-pass script sees its own work.

When the script ends, you get every changed file as one diff and approve or decline the whole set. Decline, and nothing was ever written.

`preview()` returns those staged diffs as text, which makes a dry run the model's own habit: run the script, return the preview, look, then decide whether to run it for real. That is a much better conversation than "I have updated 137 files."

## It is contained by construction

A sandbox is only worth something if it cannot be talked out of. This one is contained by what it lacks:

- A CPU budget for the script's own computation and a memory limit for its realm. Time spent waiting on a permission prompt does not count against it, so a prompt you leave sitting does not kill the run.
- An interrupt handler, so stopping the session stops the script mid-loop.
- `replace` is implemented inside the guest, deliberately. A regular expression that backtracks without end therefore burns the script's own budget and gets stopped, instead of hanging the extension host where nothing could interrupt it.
- The QuickJS build carries its WebAssembly inside the JavaScript, so there is no binary asset beside the bundle — which, in an environment where native executables are what security review blocks, is the difference between shipping and not.

A runaway loop is reported as a failed tool call. That is all it can be.

## What it buys the organisation

A bulk change is one review and one approval, not a transcript nobody reads to the end. The audit trail is a script you can keep and a diff you accepted.

And the token bill for "look at every file and tell me X" stops scaling with the number of files. It scales with the size of the answer.

## What it buys the developer

You review a diff instead of a conversation. You can ask for the dry run first. And the model can answer questions that were previously not worth asking — which files import this module but never use its default export, which handlers lack a test file, how many call sites pass the third argument — with a ten-line program instead of a guess.

## The price

The sandbox has no libraries. Scripts have to be short, and a model that returns raw file contents from one has thrown away the point of it. The tool's own description says as much, and the skill that documents the functions says it again: return a summary, not the contents.

Next, and last: the permission gate all of this leans on — and why you should have to read far fewer prompts than you do.
