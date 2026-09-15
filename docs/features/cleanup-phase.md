# Cleanup phase

A run after a feature's tests pass that measures the files its implementation edited and splits what grew past a size limit.

- Trigger: the test run over the feature's board passes. Once per feature while the window lives; the pass that proves the split does not start another.
- Files: every file an implement session on the feature edited, read from the sessions' run logs. Files changed through the shell are not seen. Files matching `kiwiAgent.cleanup.ignore` (tests by default) are not measured.
- Measure: code lines (blank and comment lines excluded) per function, per type and per file, found by braces after strings and comments are stripped, or by indentation for Python. A nested function counts toward the one it sits in. A language not known is measured as a file only.
- Limits: `kiwiAgent.cleanup.functionLines`, `typeLines`, `fileLines`; 0 turns a limit off.
- Nothing over a limit: the plan bar says so and the feature is done.
- Otherwise a cleanup run starts under the latest implement session, like a mapping run: no tab, one line on the plan bar, a Stop. It continues that session's conversation where the engine resumes, under its own prompt, tools and write scope. It gets the oversized units as its first message and may write the flagged files and new files beside them; everything else is read-only, and it has no shell.
- When it stops, the files are measured again and the test run repeats; the plan bar line carries both outcomes. A failed test run goes to the implementer as any other.
- The Sessions view lists the run as `Cleanup: <feature>` under its implement session.

Not included: a manual re-run, test runs from inside the cleanup, regex literals and heredocs in the measure, edits the implement session makes while the cleanup runs.
