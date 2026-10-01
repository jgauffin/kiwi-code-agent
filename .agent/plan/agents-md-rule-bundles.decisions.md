# Decisions for Agents.md rule bundles

### AGENTS.md and CLAUDE.md reach only chat sessions today [applied]
- on: Core behaviour stays in the prompt, Optional mechanics ship as bundles, Bundle rules reach a session as the person's own instructions do, No bundles for the blind planner
- finding: `modeSetup` in src/agent/session/mode-setup.ts hands every mode but `chat` (`implement`, `reconcile`, `cleanup`, `docs`, `file-decisions`, `docs-map`, `code-plan`) a fully custom `systemPrompt`; `startClaude`/`startOpenAi` in src/session-engines.ts only fall back to the engine's own CLAUDE.md/AGENTS.md reading (`appendSystemPrompt`+`settingSources` on the Claude engine, `buildSystemPrompt`'s `readInstructionFiles` on the OpenAI engine) when `systemPrompt` is left undefined, which happens for `chat` alone. So today no instruction file, and so no bundle, would reach an implement, reconcile, cleanup or fix session — the one rule the spec names as carrying no bundles is "the blind planner", but the code already excludes every mode that way.
- ruling: agents.md should reach chat session, normal planner the in feature planner the code mapper, implementor, tester and cleanup. So those rules also applies to bundles. But bundles are applied to agents.md so its the same, right?

### The Claude engine excludes the person's own instructions [applied]
- on: Bundle rules reach a session as the person's own instructions do, Project or person scope, Same rules on both engines after the move
- finding: in `buildOptions` (src/agent/sdk-session/sdk-session.ts) a Claude-engine chat session sets `settingSources: ['project', 'local']` by design, the comment there saying this is so the workspace's CLAUDE.md applies but not "the user's global settings, which belong to this machine, not the repo" — so a person-scope AGENTS.md or CLAUDE.md never reaches a Claude-engine session, only a workspace-scope one, while the OpenAI engine's `buildSystemPrompt` (src/agent/openai-session/system-prompt.ts, via `readInstructionFiles`) reads both scopes.
- ruling: no. bundles should only be applied to agents.md. Either in project or user profile.

### The person's memories live only in CLAUDE.md, not AGENTS.md [applied]
- on: Content moves whole, Both files already there, Same rules on both engines after the move
- finding: `userMemoryFile` in src/agent/memory/memories.ts hardcodes the person's `## Memories` section to `~/.claude/CLAUDE.md`, and every read, write and forget of a person-scope memory (`memoryPath`, `MemoryContract`, `removeUserMemoryBullet`, `userMemorySection`) targets that one path; moving and removing `CLAUDE.md` would strand an existing person's memories unless that move carries this section to `AGENTS.md` too, which the spec does not say.
- ruling: Accepting the move carries everything the file holds, the person's memories among it, and from then on memories are written to and read from `AGENTS.md`.
