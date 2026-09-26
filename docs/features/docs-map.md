# Docs map

A generated index of the product documentation that a blind planner gets up front, so it opens the one doc that answers its question instead of reading the tree.

- The map covers what a blind planner may read: every `.md` file under `docs/`, the workspace README, and nothing the `kiwiAgent.planIgnore` setting hides. It is derived from the docs alone, so a session reading it stays blind.
- One entry per doc: a line saying what the doc is for, then one line per `##` and `###` heading saying what is under it. The entries are composed into the summary the session is given at start.
- A heading is copied verbatim, because it is an anchor: a rule cites the section it came from as `path#Heading`, and a heading the map invents or misspells is a citation that leads nowhere. The extension checks every entry against the doc's real headings as it is written and hands back what does not match, so it is fixed in the turn that wrote it. A heading inside a fenced code block is an example, not a heading.
- Writing the lines needs a model, so the map carries an index of path to content hash: a build re-reads only the docs whose content changed, forgets the entries of docs that are gone, and describes the new ones. A touch that changed nothing, a line-ending change and an edit that was reverted all cost nothing.
- The build is one run with no tab and no conversation: it reads the docs it was handed, writes an entry each and ends. Its read scope is those docs, so it never sees the code.
- A doc is stamped in the index only once its entry is on disk and on contract, so a run that stopped halfway costs the next build a re-read of what it did not finish and never a wrong hash.
- Command `KiwiAgent: Build Docs Map` builds it; a plan session and a docs evaluation build it first when it is behind. A build that fails or passes its time bound does not hold the session start: it begins on the map as it last stood, or on none, and is told which.
- Plan sessions and docs evaluations get the summary as context; nothing reads the map through tools, and nothing may write into it.
- Two callers asking at once share one build rather than spending the turn twice.

Not included: an index of the specs under `plan/`, a profile of its own for the build, rebuilding in the background instead of before a session start.
