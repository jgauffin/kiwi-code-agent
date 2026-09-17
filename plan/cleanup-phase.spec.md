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
