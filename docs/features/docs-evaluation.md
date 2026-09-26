# Docs evaluation

A session that judges the docs as a blind planner's way in and says where their arrangement would cost one, started from the Evaluate docs card on the new-session screen.

- It reads what the planner reads: `docs/**`, the workspace README and every spec under `plan/*.spec.md`, never the code and never the mapper's tasks or decisions files, which were written by a run that read it. It starts with the docs map, so it opens a doc only when the map does not say enough.
- It judges discovery, not correctness and not completeness: a doc that has to be read whole to answer one question, a heading that does not say what is under it, a subject spread over docs with nothing linking them, a folder with no way in, a term the docs lean on but define nowhere, a passage a rule would cite that sits under no heading.
- A heading an approved spec cites is load-bearing: renaming or moving it breaks the citation and nothing would report it. A proposed change to such a heading names every citation that would have to follow, so the user chooses with that in front of them. A doc that is split keeps its headings on the parts.
- The findings are said in chat, one line each: the section as `path#Heading`, what it costs a planner, and the change in one sentence, strongest first. Nothing is written. An empty list is a good result.
- The user picks what to change and the session edits only that; `docs/` is the user's, so every write is confirmed one at a time. The next docs map build re-reads only what changed.
- It has no feature and no plan files, so no plan bar and no stage: it is a conversation, like chat, with a planner's read scope.

Not included: checking the docs against the code, a findings file, applying every suggestion at once.
