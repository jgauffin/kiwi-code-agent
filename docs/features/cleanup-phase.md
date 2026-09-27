# Cleanup phase

The step after a feature's tests pass: the files its implementation edited are measured against the size limits, and the user says whether to split what is over them.

- Trigger: the test run over the feature's board passes. The sweep is mechanical, no model and no session.
- Files: every file an implement session on the feature edited, read from the sessions' run logs. Files changed through the shell are not seen. Files matching `kiwiAgent.cleanup.ignore` (tests by default) are not measured.
- Measure: code lines per function, per type and per file, with blank and comment lines excluded. A file whose functions cannot be located is measured as a file only.
- Limits: `kiwiAgent.cleanup.functionLines`, `kiwiAgent.cleanup.typeLines`, `kiwiAgent.cleanup.fileLines`; 0 turns a limit off.
- Nothing over a limit: the Cleanup step reads verified and the feature is done.
- Otherwise the units are listed on the Tasks tab under the test-run line, and the Cleanup step points at them. Nothing is split until the user picks one of three: **Clean up** starts the run, **Later** leaves the offer standing, **Skip** settles the feature as it is.
- Later and Skip are written to the tasks file front matter as `cleanup: postponed | skipped`, so a reload does not ask again. A feature with a postponed cleanup is not counted verified and keeps its place in the plan list; a skipped one is finished.
- The run starts under the first implement session, like a mapping run: no tab, one line on the plan bar naming it, a Stop. It continues that session's conversation where the engine resumes, under its own prompt, tools and write scope. It gets the oversized units as its first message and may write the flagged files and new files beside them; everything else is read-only, and it has no shell.
- However the run ends, the files are measured again, `cleanup: done` is written and the test run repeats; the plan bar line carries both outcomes. A failed test run goes to the implementer as any other, until the board is green. What is still over a limit is reported and left: the split is attempted once.
- The Sessions view lists the run as `Cleanup: <feature>` under its implement session.
- A window that has made no sweep for a feature offers **Check sizes** at the Cleanup step rather than measuring on its own.

Not included: test runs from inside the cleanup, regex literals and heredocs in the measure, edits the implement session makes while the cleanup runs.

The measure knows a fixed list of languages and finds the units of a file without parsing it. A file in a language the measure does not know is measured as a file only.

The measure after the run covers the files the run wrote, the new ones it created beside them included, under the same ignore globs as the first.

A test run that fails after the cleanup is an ordinary verify failure: it goes to the implement session with its output and counts against the verify failure budget, and when the budget is spent the failed record stays for the user.
