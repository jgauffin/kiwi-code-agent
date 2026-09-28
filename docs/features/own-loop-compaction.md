# Own-loop compaction

The own agent loop over an OpenAI-compatible model keeps working when a conversation outgrows the model's context window. The Claude engine compacts for itself and none of this applies to it.

## When it happens

- Context window per model comes from the `kiwiAgent.contextWindows` setting (model id → tokens); a model not listed is treated as 128k.
- Usage is tracked from each completion's prompt token count. At 90% of the window the engine compacts before the next request.
- A provider error saying the context is too long triggers a compaction and one retry per turn; a second failure ends the turn with an error.
- A conversation with nothing older to fold is not compacted: one turn that overflows the window on its own fails loudly rather than being summarised into silence.

## What survives

The turns kept verbatim are whole turns from the end, taken until they would fill 30% of the window — not a fixed count, so a turn of one small tool call does not cost as much as a turn that read half the repo. The last turn is kept whatever it costs.

Everything between the system prompt and the kept tail is folded into a summary written by the same model from a fixed prompt (what was asked, what was done, what is still open, files touched). The summariser is given the folded turns as a transcript with tool results left out, since they are the bulk; what the calls were for is what the summary carries. It is given no tools.

The compacted conversation is `[system, summary, ledger, ...kept turns]`.

## The ledger

Folding the turns away takes the file contents with them, and without help the model would have to search the repo again to find what it had already found. The ledger is the map back: which files the session has read, with the line ranges asked for; which it has edited, with the lines the edit landed on; which it has written.

It lives on the session, fed as the tools run, and is re-rendered from there at every compaction. It is deliberately not carried inside the summary — the next compaction would hand that text to the summariser, which would paraphrase the ranges away. Files past the most recent 60 drop off, oldest touch first.

## Reading again before writing

The read tracker refuses an edit to a file the model never read. Compaction makes it lie: the read is gone from the conversation but the tracker still remembers it. So compaction forgets every file whose read was folded away, keeping only those the remaining messages still show being read.

This matters most for `Write`, which checks staleness and then overwrites wholesale — without it, a post-compaction `Write` could clobber a file with a version reconstructed from memory. `Edit` fails safe either way, since `old_string` must match exactly.

The ledger says where to look; the tracker makes the model actually look.

## What the session reports

A `status: compacting` event while it runs, then a `compacted` event carrying the summary and what the prompt cost beforehand. The chat shows it as a marker the reader can expand to see the summary. The Claude engine maps its own `compact_boundary` to the same event, reporting sizes but no summary.

Compaction never touches the run log; the full history stays on disk.

## Not included

Cross-session memory, manual compaction, anthropic-style context editing. The ledger is not yet rebuilt when a session resumes from its run log, so a resumed session starts with an empty one.
