---
feature: Cleanup phase
status: approved
---

# Cleanup phase

## Goal
When a feature's tests pass, the person who planned it still has no idea whether the implementation left behind a function nobody can follow or a file nobody can hold in their head. The cleanup phase closes that gap mechanically: the moment a feature's board verifies, the files its implement sessions wrote are measured, and anything past a limit is handed back to the implementer's own conversation as a single split pass, after which the code is measured and tested again. It reacts to size and branching only — never to taste — so a feature is finished either clean or with the plan bar naming exactly what is still too big.

## A feature's tests pass
- **B1**: a passing test run over a feature's board measures the files that feature's implementation edited; when nothing is over a limit the plan bar says so and the feature is done. (docs/features/cleanup-phase.md#Cleanup phase)
- **B2**: a feature is cleaned at most once for as long as the window lives — the test run that follows a cleanup starts no second one, and neither does any later pass. (docs/features/cleanup-phase.md#Cleanup phase)
  - **E1**: the record of having cleaned a feature is held in memory only, so after a window reload a passing test run may clean the same feature again.

## What counts as too big
The units measured and the limits they are held to.
- **B3**: the files measured are the ones an implement session on this feature edited, taken from those sessions' run logs; a file changed through the shell is not among them. (docs/features/cleanup-phase.md#Cleanup phase)
  - **E2**: a file that is no longer there when the measure runs is passed over, not reported.
- **B4**: a file matching `kiwiAgent.cleanup.ignore` (tests by default) is not measured. (docs/features/cleanup-phase.md#Cleanup phase)
- **B5**: a function is oversized when its cyclomatic complexity is over `kiwiAgent.cleanup.functionComplexity`; its branch points are the branching keywords and operators of the language the file is written in, drawn from the fixed set of languages the measure knows and found without parsing the file, and a nested function's branches count toward the function it sits in, not as a unit of their own.
- **B6**: a file is oversized when its code lines, blank and comment lines excluded, are over `kiwiAgent.cleanup.fileLines`. (docs/features/cleanup-phase.md#Cleanup phase)
  - **E3**: when the functions of a file cannot be located — a file in a language the measure does not know among them — the file is measured as a file only and no function of it is ever flagged.
- **B7**: a limit of 0 is off and flags nothing; with every limit off the feature is done as in B1. Functions and files are the only units measured: a type has no limit of its own, `kiwiAgent.cleanup.typeLines` goes with the measure, and no unit of that kind is flagged. (docs/features/cleanup-phase.md#Cleanup phase)

## The cleanup run
- **B8**: the run starts under the feature's latest implement session and continues that session's conversation where the engine resumes, under its own prompt, tools and write scope: no tab and no transcript of its own, one line on the plan bar and a Stop. (docs/features/cleanup-phase.md#Cleanup phase)
  - **E4**: on an engine that cannot resume a conversation, the run starts fresh rather than not at all.
- **B9**: its first message is the oversized units, each naming its file, what it measured and the limit it passed. (docs/features/cleanup-phase.md#Cleanup phase)
- **B10**: it may write the flagged files and new files beside them, without a permission prompt; every other path is read-only and a write to one is refused, and it has no shell. (docs/features/cleanup-phase.md#Cleanup phase)
- **B11**: however the run ends — of its own accord or because the user stopped it — the files are measured again and the test run repeats, and the plan bar line carries both outcomes; the second measure covers the flagged files together with the new files the run wrote beside them, under the same ignore globs as the first. (docs/features/cleanup-phase.md#Cleanup phase)
  - **E5**: a unit still over its limit after the run is reported on the plan bar and left alone; one pass per feature, never a second.
- **B12**: a test run that fails after the cleanup goes to the implement session like any other failure, the verify failure budget included, so a split the implementer cannot repair reaches the user instead of looping; no such pass starts another cleanup. (docs/features/cleanup-phase.md#Cleanup phase)
- **B13**: the Sessions view lists the run as `Cleanup: <feature>` under the implement session it runs beneath. (docs/features/cleanup-phase.md#Cleanup phase)

## Decisions
### F1 [applied]
- on: B5
- finding: B5 assumes branch points are "counted the same way in every language". There is no branch counting in the code at all, and no parser: `measureUnits` in src/agent/cleanup/unit-size.ts finds units by braces or indentation over literal-stripped text, and `languageOf` in src/agent/cleanup/language.ts knows a fixed extension table (JS/TS, C#, Java, Go, Rust, Kotlin, Swift, C/C++, PHP, Python — no Ruby, Scala, Perl…), with many units named `(anonymous)`. The spec should say complexity is counted from a fixed set of branching keywords and operators matched in the stripped source of a language the measure knows, each language's own keywords, and that a file in an unknown language has no function complexity (as E3). Amendment A2.
- proposed: Accept: B5 should say the branch points are the branching keywords and operators of the language the file is written in, drawn from the fixed set of languages the measure knows, found without parsing; "the same way in every language" promised a uniformity nothing can deliver. E3 then reads as the unknown-language case rather than only the unparseable one, and A2 records it.
- ruling: accepted

### F2 [applied]
- on: B5
- finding: the code measures a third unit kind, `type`, against `kiwiAgent.cleanup.typeLines` (default 200) — `UnitKind` in src/agent/cleanup/unit-size.ts, `limitFor`/`anyLimit` in src/agent/cleanup/oversized.ts, `cleanupThresholds` in src/extension.ts, the setting in package.json, the prompt's limit list in `cleanupPrompt`. The spec measures only functions and files, which retires that limit silently and leaves a shipped setting configured but dead.
- proposed: The spec stands: you ruled for complexity per function and lines per file, and a type's line count says little once its methods are held to a complexity limit. What the spec owes is to say the retirement out loud — the `typeLines` setting goes with the measure, and no unit of that kind is flagged — which I would add to B7 and record as an amendment; keeping a third limit is the other way, and yours to take.
- ruling: accepted

### F3 [applied]
- on: B11, E5
- finding: the spec assumes the second measure catches what the run left. `finishCleanup` in src/chat/chat-view-provider.ts measures only `child.files`, the paths flagged before the run, so a file the run created beside them — where `cleanupScope` in src/agent/phases/cleanup.ts tells it to put a split — is never measured and an oversized new file goes unreported; that second measure also passes an empty ignore list, so B4 does not hold on it. The spec should say the second measure covers the files the run wrote, the new ones included, under the same ignore globs. Amendment A3.
- proposed: Accept: B11 should say the second measure covers the flagged files together with the new files the run wrote beside them, under the same ignore globs as the first, since a split that only moves the excess into an oversized new file is exactly what E5 has to report. A3 records it.
- ruling: accepted

### F4 [applied]
- on: B12
- finding: `verify` in src/chat/chat-view-provider.ts hands a failing run to the implementer only while consecutive failures are within `kiwiAgent.verifyFailureBudget` (default 3), then leaves the failed record for the user; B12 says the run repeats until the board is green again. Whether the post-cleanup failure is exempt from the budget or counted in it is the ruling; the task is one line in `verify`.
- proposed: Rule for the code: a post-cleanup failure is an ordinary failure and counts against `kiwiAgent.verifyFailureBudget`, because a split the implementer cannot repair would otherwise loop without end and never reach the user. I would revise B12 to say it is handed over like any other failure, the budget included, and drop "until the board is green again".
- ruling: accepted
