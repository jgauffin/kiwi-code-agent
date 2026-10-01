---
title: A sandbox instead of forty tool calls
published: false
description: Kiwipow Agent lets the model write one sandboxed JavaScript program instead of hundreds of tool calls, and you approve its edits as one diff.
tags: ai, javascript, security, vscode
series: A coding agent that plans blind
---

Ask an agent to rename a function across four hundred files and watch what happens. Four hundred reads, four hundred edits, each one a round trip, each one paying for the file in context, and a conversation you cannot review.

The agent does not need four hundred tool calls. It needs one program.

## What you see

One tool call in the transcript, one line of result, and one review: every file the script changed, as a single diff you approve or decline.

![RunScript's staged edits, shown as one diff to approve](https://raw.githubusercontent.com/jgauffin/kiwi-code-agent/main/articles/images/runscript-diff.png)

A rename is four lines:

```js
const files = await glob({ pattern: 'src/**/*.ts' })
let total = 0
for (const f of files) total += (await replace(f, '\\bgetUser\\(', 'fetchUser(')).matches
return `${total} calls in ${files.length} files`
```

A rename is something your IDE can do too. The better use is a question your IDE cannot answer. Say you are about to change how refunds work and want to know which payment files have no test beside them:

```js
const files = await glob({ pattern: 'src/payments/**/*.ts' })
const untested = []
for (const file of files) {
  if (file.endsWith('.test.ts')) continue
  if (!(await exists(file.replace(/\.ts$/, '.test.ts')))) untested.push(file)
}
return untested
```

Eight lines, one call, and the answer is a short list instead of a guess. The files themselves never enter the conversation, because only what the script returns or logs comes back.

## How it works

`RunScript` takes the body of an async JavaScript function (`await` and `return` work at the top level) and runs it in a fresh QuickJS realm compiled to WebAssembly. The realm has no Node, no `require`, no `fetch`, no file system and no process of its own. There is exactly one way out, and it is a list of functions the host offers:

`read`, `readdir`, `exists`, `write`, `edit`, `replace`, `move`, `copy`, `remove`, `preview`, `glob`, `grep`, `codeSearch`, `markdownSearch`, `codeOutline`, `jsonQuery`, `jsonSchema`.

There is no shell among them, on purpose: a loop of commands would be a loop of permission prompts.

**Every call is still gated.** Each `read`, `write` or `edit` from inside the sandbox goes through the same permission gate the model's own tool calls go through, and a denied call throws; the script can catch it and carry on. So `RunScript` itself needs no permission. It can do nothing on its own.

**Edits are staged.** Nothing is written while the script runs. `write`, `edit` and `replace` stage the result in memory, and `read` returns the staged version of a file the script already changed, so a two-pass script sees its own work. Decline the diff, and nothing was ever written. `preview()` returns the staged diffs as text, so the model can do a dry run, look, and then decide.

**It is contained by what it lacks.**

- A CPU budget for the script's own computation and a memory limit for its realm. Time spent waiting on a permission prompt does not count, so a prompt you leave sitting does not kill the run.
- An interrupt handler, so stopping the session stops the script mid-loop.
- `replace` runs inside the guest, deliberately. A regular expression that backtracks without end burns the script's own budget and gets stopped, instead of hanging the extension host.
- The QuickJS build carries its WebAssembly inside the JavaScript, so there is no native binary beside the bundle for a security review to block.

A runaway loop is reported as a failed tool call. That is all it can be.

## Why you'd want it

You review a diff instead of a conversation, and a bulk change is one approval instead of a transcript nobody reads to the end.

The cost of "look at every file and tell me X" stops growing with the number of files. It grows with the size of the answer.

And the model can answer questions that were not worth asking before: which files import a module but never use it, which handlers lack a test, how many call sites pass the third argument.

## The price

The sandbox has no libraries. Scripts have to be short, and a model that returns raw file contents from one has thrown away the point of it. The tool's description says so, and so does the skill that documents the functions: return a summary, not the contents.

What would you ask your codebase if the answer cost one tool call?

Next: why the planner is not allowed to read your code at all.

---

*Kiwipow Agent is on the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=CoderrAB.kiwipow-agent); source and issues are on [GitHub](https://github.com/jgauffin/kiwi-code-agent).*
