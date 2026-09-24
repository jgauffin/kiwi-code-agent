# AskUserQuestion

The model asks structured questions and gets the answers back as tool input, on both engines.

- Claude engine: the SDK routes the `AskUserQuestion` tool through the permission callback; the answer goes back as `updatedInput` with the answers filled in.
- Own-loop engine: a tool of the same name and schema (questions with header, options, multi-select).
- The transcript shows a question card per request, one question at a time (Back, Next, Submit on the last): single or multi select, free-text "Other". Submit resolves the request; the session status is `needs_human` until then. A resolved card shows each question with its answer as text.
- Answers are recorded in the run log like any tool result, so a replayed transcript shows what was asked and answered.
- Plan mode prompt drops the "ask in text and stop" rule once this exists.

Not included: questions with previews, questions from subagents shown separately.
