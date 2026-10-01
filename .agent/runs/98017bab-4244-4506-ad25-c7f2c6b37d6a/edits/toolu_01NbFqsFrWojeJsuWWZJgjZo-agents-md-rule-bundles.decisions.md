# Decisions for Agents.md rule bundles

### AGENTS.md and CLAUDE.md reach only chat sessions today
- on: Core behaviour stays in the prompt, Optional mechanics ship as bundles, Bundle rules reach a session as the person's own instructions do, No bundles for the blind planner
- finding: `modeSetup` in src/agent/session/mode-setup.ts hands every mode but `chat` (`implement`, `reconcile`, `cleanup`, `docs`, `file-decisions`, `docs-map`, `code-plan`) a fully custom `systemPrompt`; `startClaude`/`startOpenAi` in src/session-engines.ts only fall back to the engine's own CLAUDE.md/AGENTS.md reading (`appendSystemPrompt`+`settingSources` on the Claude engine, `buildSystemPrompt`'s `readInstructionFiles` on the OpenAI engine) when `systemPrompt` is left undefined, which happens for `chat` alone. So today no instruction file, and so no bundle, would reach an implement, reconcile, cleanup or fix session — the one rule the spec names as carrying no bundles is "the blind planner", but the code already excludes every mode that way.
- proposed: An applied bundle joins the instructions of a chat session, of the check against the code and of every implementation run exactly where the workspace's and the person's instruction files join them, on either engine.
- proposed: An applied bundle joins the instructions of every session that writes code — implementation, fix and cleanup runs — and of chat, and no other session carries bundle rules.
- proposed: An applied bundle joins the instructions of a chat session only, where the workspace's and the person's instruction files already join them, on either engine.
- recommended: 1
- because: It hands bundles to the same phases that already carry skills and withholds them from the same one, so how-code-is-written guidance reaches a session by one rule rather than two.

### The Claude engine excludes the person's own instructions
- on: Bundle rules reach a session as the person's own instructions do, Project or person scope, Same rules on both engines after the move
- finding: in `buildOptions` (src/agent/sdk-session/sdk-session.ts) a Claude-engine chat session sets `settingSources: ['project', 'local']` by design, the comment there saying this is so the workspace's CLAUDE.md applies but not "the user's global settings, which belong to this machine, not the repo" — so a person-scope AGENTS.md or CLAUDE.md never reaches a Claude-engine session, only a workspace-scope one, while the OpenAI engine's `buildSystemPrompt` (src/agent/openai-session/system-prompt.ts, via `readInstructionFiles`) reads both scopes.

### The person's memories live only in CLAUDE.md, not AGENTS.md
- on: Content moves whole, Both files already there, Same rules on both engines after the move
- finding: `userMemoryFile` in src/agent/memory/memories.ts hardcodes the person's `## Memories` section to `~/.claude/CLAUDE.md`, and every read, write and forget of a person-scope memory (`memoryPath`, `MemoryContract`, `removeUserMemoryBullet`, `userMemorySection`) targets that one path; moving and removing `CLAUDE.md` would strand an existing person's memories unless that move carries this section to `AGENTS.md` too, which the spec does not say.
