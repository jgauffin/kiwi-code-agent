# Cleanup phase

A run after a feature's tests pass that measures the files its implementation edited and splits what is too complex or too large.

- Trigger: the test run over the feature's board passes. Once per feature while the window lives; the pass that proves the split does not start another.
- Files: every file an implement session on the feature edited, read from the sessions' run logs. Files changed through the shell are not seen. Files matching `kiwiAgent.cleanup.ignore` (tests by default) are not measured.
- Measure: cyclomatic complexity per function, from the branch points in it, counted the same way in every language; a nested function's branches count toward the function it sits in. Per file, code lines, with blank and comment lines excluded. A file whose functions cannot be located is measured as a file only.
- Limits: `kiwiAgent.cleanup.functionComplexity`, `kiwiAgent.cleanup.fileLines`; 0 turns a limit off.
- Nothing over a limit: the plan bar says so and the feature is done.
- Otherwise a cleanup run starts under the latest implement session, like a mapping run: no tab, one line on the plan bar, a Stop. It continues that session's conversation where the engine resumes, under its own prompt, tools and write scope. It gets the oversized units as its first message and may write the flagged files and new files beside them; everything else is read-only, and it has no shell.
- However the run ends, the files are measured again and the test run repeats; the plan bar line carries both outcomes. A failed test run goes to the implementer as any other, until the board is green. What is still over a limit is reported and left: the split is attempted once.
- The Sessions view lists the run as `Cleanup: <feature>` under its implement session.

Not included: a manual re-run, test runs from inside the cleanup, regex literals and heredocs in the measure, edits the implement session makes while the cleanup runs.

The measure knows a fixed list of languages and finds the functions of a file without parsing it. Branch points are the branching keywords and operators of the language the file is written in. A file in a language the measure does not know is measured as a file only.

The measure after the run covers the files the run wrote, the new ones it created beside them included, under the same ignore globs as the first.

Functions and files are the only units measured. A type has no limit of its own and no unit of that kind is flagged; `kiwiAgent.cleanup.typeLines` goes with the measure.

A test run that fails after the cleanup is an ordinary verify failure: it goes to the implement session with its output and counts against the verify failure budget, and when the budget is spent the failed record stays for the user.
