---
title: Why my coding agent isn't allowed to grade its own work
published: false
description: In Kiwipow Agent a feature is finished when your tests pass and your size limits hold, not when the model says so.
tags: ai, testing, codequality, softwareengineering
series: A coding agent that plans blind
---

Ask a model whether the code it just wrote is good and it will tell you. That is the problem. The answer is fluent, agreeable and worth nothing, because the thing being graded wrote the grade.

Ask it to make the code better and it gets worse in a different way. An agent told "improve this" keeps going for as long as you pay it, and the second pass over its own work is exactly where it starts moving code sideways.

So in Kiwipow Agent the end of a feature is decided by machinery. The test run has no model in it. The cleanup is triggered by numbers you set, runs once, and never twice.

## What you see

When the last task is marked tested, the plan bar says which test commands ran, in which project, and how it went.

![The plan bar after verification: which commands ran, in which project, and the outcome](https://raw.githubusercontent.com/jgauffin/kiwi-code-agent/main/articles/images/verification-bar.png)

If the feature left something too big behind, the Cleanup tab lists it, with the choice in your hands.

![The Cleanup tab: units over their limit, with the choices](https://raw.githubusercontent.com/jgauffin/kiwi-code-agent/main/articles/images/cleanup-offer.png)

## Verification: only the suites the feature touched

When every task is tested, the extension runs the test commands itself. A rule is a file glob, an optional project marker and a command:

```json
"kiwiAgent.verify": [
  { "match": "**/*.cs", "project": "*.csproj", "command": "dotnet test \"{project}\" --nologo" },
  { "match": "src/**/*.{ts,tsx,js}", "project": "package.json", "command": "npm test" }
]
```

The rules are matched against the files the tasks name, and each command runs in the directory of the nearest project file. Say the refund fix touched only the payments project: only the payments suite runs. A repository with a backend and a frontend bundle runs each once, not once per file.

A failure goes to a fix run with the command and its output, and each fix after another failure runs at a higher effort level. After a set number of failures in a row it stops, and the failed record waits for you. When several sessions share a workspace, a failure only in code another session changed is not handed to your implementer: the run waits, tries once more, and then holds it for you.

No model decides whether the tests were good enough. They passed or they did not.

## Cleanup: size, never taste

Passing tests say nothing about whether the implementation left a function nobody can follow. So once the tests pass, the files the feature's implementation runs edited are measured:

- a function over `kiwiAgent.cleanup.functionComplexity` in cognitive complexity: each branch, loop and catch costs one plus how deeply it is nested
- a function over `kiwiAgent.cleanup.functionLines` code lines, which catches the long function that barely branches
- a type over `kiwiAgent.cleanup.typeLines` code lines
- a file over `kiwiAgent.cleanup.fileLines` code lines

A limit of `0` is off. Test files get their own, larger limits, since a test file grows with the code it covers; which files count as tests is a glob list you control. The measure reads declarations for a fixed set of languages; a file in a language it does not know is measured as a file only. A crude measure that states its limits beats a clever one that guesses.

Nothing is split on the measure alone. You pick: clean up all, clean up the files you choose, later, or **Skip**.

If you split, a cleanup run starts on the size report, with no shell. It may write the flagged files and new files beside them, and note any code that belongs further away in a moves file for you; every other path is read-only. When it ends, the files are measured again and the tests run again.

## One pass, never two

A unit still over its limit after the pass is reported and left alone. The feature is finished, with the plan bar naming what is still too big. A test failure after the cleanup goes to a fix run under the same budget, so a split it cannot repair reaches you instead of looping.

## Why you'd want it

"Done" means something you can check: every rule has a task, every task names its tests, the suites the feature touched ran green, and what it wrote is within your limits, or the exceptions are on screen.

No moralising. The agent does not rewrite your naming, argue about abstractions or discover that your file "could be cleaner". It reacts to a few numbers in your settings, and when you disagree, you change one line of JSON or press Skip.

And the bill is bounded: a fix budget and one cleanup pass, not an agent polishing until you stop it.

## The price

Line counts are proxies, and everybody knows a clean 200-line file and a horrible 40-line one. Fine. The alternative on offer is a language model's taste, applied to your codebase, with no argument you can win.

What do you let a machine decide that you would never let a model decide?

Next: how every rule in a spec gets a test, and how you see the ones that don't.

---

*Kiwipow Agent is on the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=CoderrAB.kiwipow-agent); source and issues are on [GitHub](https://github.com/jgauffin/kiwi-code-agent).*
