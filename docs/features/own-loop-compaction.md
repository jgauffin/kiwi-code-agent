# Own-loop compaction

The Berget engine keeps working when a conversation outgrows the model's context window.

- Context window per model comes from a `kiwiAgent.contextWindows` setting (model id → tokens); unknown models are treated as 128k.
- Usage is tracked from each completion's prompt token count. At 80% of the window the engine compacts before the next request.
- Compaction: the oldest turns are replaced by a summary written by the same model from a fixed prompt (what was asked, what was done, what is still open, files touched), plus the last two turns kept verbatim. Tool results older than the kept turns are dropped from the history first, before summarising, since they are the bulk.
- A `status: compacting` event is emitted and the transcript shows a compaction marker with the summary.
- A provider error that says the context is too long triggers a compaction and one retry; a second failure ends the turn with an error.
- Compaction never touches the run log; the full history stays on disk.

Not included: cross-session memory, manual compaction, anthropic-style context editing.
