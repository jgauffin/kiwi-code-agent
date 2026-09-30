---
title: A finish nothing has an opinion about
published: false
tags: ai, testing, codequality, softwareengineering
series: A coding agent that plans blind
---

Ask a model whether the code it just wrote is good and it will tell you. That is the problem. The answer is fluent, agreeable and worth nothing, because the thing being graded wrote the grade.

So in Kiwipow Agent the last two steps of a feature have no model in them.

## Verification: only the suites the feature touched

When every task on a board is marked `[tested]`, the extension runs the test commands itself. A rule is a file glob, a project marker and a command:

```json
"kiwiAgent.verify": [
  { "files": "**/*.cs", "project": "*.csproj", "command": "dotnet test" },
  { "files": "src/**/*.ts", "project": "package.json", "command": "npm test" }
]
```

The rules are matched against the files the tasks name, and the command runs in the directory of the nearest project file. A feature that touched only the backend runs only the backend's suite. A repository with a backend and a frontend bundle runs each once, not once per file.

The outcome goes under `## Verification` in the tasks file, newest first; the output tail goes to the run log. A failure is handed back to the implement session with the command and its output, and the run repeats when the board is all tested again — up to a set number of consecutive failures, after which it stops and the failed record stays there for you.

No model decides whether the tests were good enough. The tests either passed or they did not.

## Cleanup: size and branching, never taste

Passing tests say nothing about whether the implementation left behind a function nobody can follow. So the moment a board verifies, the files that feature's implement sessions edited are measured. Two units, two limits:

- a function whose cyclomatic complexity is over `kiwiAgent.cleanup.functionComplexity`
- a file whose code lines, blanks and comments excluded, are over `kiwiAgent.cleanup.fileLines`

A limit of `0` is off. A file whose name starts or ends with "test", in any case, is held to separate, larger test limits, since a test file stays one file per tested file. The ignore list is yours. Only files an implement session edited are measured — something changed through the shell is not among them — and a file that is no longer there is passed over rather than reported.

The measure does not parse your code. It knows the branching keywords and operators of a fixed set of languages and counts them; a nested function's branches count toward the function it sits in. A file in a language it does not know is measured as a file only, and no function of it is ever flagged. That is a deliberate ceiling: a crude measure that states its own limits beats a clever one that quietly guesses.

Then anything over a limit goes back to the implementer as a single split pass. The run continues that session's own conversation, so the code does not have to be re-read. It has its own prompt, no shell, and it may write the flagged files and new files beside them — every other path is read-only and a write to one is refused. It gets no transcript of its own: one line on the plan bar, and a Stop.

However it ends, of its own accord or because you stopped it, the files are measured again and the tests run again. Both outcomes land on the plan bar.

## One pass, never two

A unit still over its limit after the pass is reported and left alone. The feature is finished, with the plan bar naming exactly what is still too big.

This is the rule that keeps the whole thing from being a money furnace. An agent given "make this better" will keep going for as long as you pay it, and a second pass over its own split is exactly where it starts moving code sideways. One pass per feature. A test failure after the cleanup goes to the implementer like any other failure, under the same budget, so a split it cannot repair reaches you instead of looping.

## What it buys the organisation

A gate that cannot be talked around. "Done" means: every rule has a task, every task names a passing test, the suites the feature touched ran green, and nothing it wrote is over the limits you set — or the exceptions are named on screen.

And a bounded bill. Every loop in the system has a counter on it.

## What it buys the developer

No moralising. The agent does not rewrite your naming, argue about abstractions or discover that your file "could be cleaner". It reacts to two numbers, and the numbers are in your settings.

When it does flag something, you can disagree with it in one line of JSON.

## The price

Cyclomatic complexity and line counts are proxies, and everybody knows a clean 200-line file and a horrible 40-line one. Fine. The alternative on offer is a language model's taste, applied to your codebase, at scale, with no argument you can win.

Next: why the model that plans does not have to be the model that grinds.
