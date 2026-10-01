---
doc: docs/features/own-loop-compaction.md
---
How a conversation that outgrows the model's context window is folded down without losing the work, on the own loop and on the Claude engine.

- `#When it happens`: the window per model, the 90% and compaction-limit thresholds, the too-long-context retry, and the one turn that is left to fail rather than summarised
- `#What survives`: the tail of whole turns kept verbatim, the fixed summariser prompt over the rest, and the shape of the compacted conversation
- `#The ledger`: the record of files read, edited and written that replaces the folded file contents, why it lives outside the summary, and its 60-file cap
- `#Reading again before writing`: why compaction clears the read tracker for folded reads, and what that protects `Write` from
- `#What the session reports`: the `compacting`, `compacted` and `context_usage` events, the chat marker, and the untouched run log
- `#Manual compaction`: the meter under the chat box and what its button does between turns and mid-turn
- `#Claude engine`: auto-compaction disabled, the engine's own window, the 75% interrupt-and-`/compact` turn, failure handling, and `compact_boundary` mapping
- `#Not included`: cross-session memory, context editing, and the ledger not surviving a resume
