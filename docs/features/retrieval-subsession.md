# Retrieval sub-session

A tool the reconcile and implement phases call to look things up without filling their own context with file dumps.

- Tool `retrieve(question, known, budget)` available in reconcile and implement sessions.
- Runs as its own `CodeSession` on the profile named by `kiwiAgent.retrievalProfile` (a cheap model is fine).
- Its tools are the calling phase's tools minus anything that writes and minus AskUserQuestion. Depth 1: it cannot call `retrieve` itself.
- It locates and quotes; it does not interpret. Output is verbatim excerpts with provenance (`path#heading` or `path:line-range`) and one line on why each matches.
- Result file `.agent/runs/<session id>/retrieval/<n>.md` with `findings[]`, `not_found[]` (what was looked for, where), `status: complete | partial | budget_exhausted`. The tool returns the path, the status and the counts; the caller reads the file.
- Budget is per call (tool calls and tokens), set by the caller; exhaustion returns what was found so far.
- Independent questions are independent sessions with no shared state; the caller may issue several at once.
- The transcript shows a retrieval as one collapsible row with the question, status and counts; the sub-session's own transcript is reachable from it.
- The type indexes of the repo map are the sub-session's to read, by the path it is given. Nothing of the map is injected into it.

Not included: retrieval in the plan phase, caching across sessions, a repo map (separate feature).
