# Decisions for Agents.md rule bundles

### AGENTS.md and CLAUDE.md reach only chat sessions today [applied]
- on: Core behaviour stays in the prompt, Optional mechanics ship as bundles, Bundle rules reach a session as the person's own instructions do, No bundles for the blind planner
- finding: `modeSetup` in src/agent/session/mode-setup.ts hands every mode but `chat` (`implement`, `reconcile`, `cleanup`, `docs`, `file-decisions`, `docs-map`, `code-plan`) a fully custom `systemPrompt`; `startClaude`/`startOpenAi` in src/session-engines.ts only fall back to the engine's own CLAUDE.md/AGENTS.md reading (`appendSystemPrompt`+`settingSources` on the Claude engine, `buildSystemPrompt`'s `readInstructionFiles` on the OpenAI engine) when `systemPrompt` is left undefined, which happens for `chat` alone. So today no instruction file, and so no bundle, would reach an implement, reconcile, cleanup or fix session — the one rule the spec names as carrying no bundles is "the blind planner", but the code already excludes every mode that way.
- proposed: An applied bundle joins the instructions of a chat session, of the check against the code and of every implementation run exactly where the workspace's and the person's instruction files join them, on either engine.
- proposed: An applied bundle joins the instructions of every session that writes code — implementation, fix and cleanup runs — and of chat, and no other session carries bundle rules.
- proposed: An applied bundle joins the instructions of a chat session only, where the workspace's and the person's instruction files already join them, on either engine.
- recommended: 1
- because: It hands bundles to the same phases that already carry skills and withholds them from the same one, so how-code-is-written guidance reaches a session by one rule rather than two.
- ruling: agents.md should reach chat session, normal planner the in feature planner the code mapper, implementor, tester and cleanup. So those rules also applies to bundles. But bundles are applied to agents.md so its the same, right?

### The Claude engine excludes the person's own instructions [applied]
- on: Bundle rules reach a session as the person's own instructions do, Project or person scope, Same rules on both engines after the move
- finding: in `buildOptions` (src/agent/sdk-session/sdk-session.ts) a Claude-engine chat session sets `settingSources: ['project', 'local']` by design, the comment there saying this is so the workspace's CLAUDE.md applies but not "the user's global settings, which belong to this machine, not the repo" — so a person-scope AGENTS.md or CLAUDE.md never reaches a Claude-engine session, only a workspace-scope one, while the OpenAI engine's `buildSystemPrompt` (src/agent/openai-session/system-prompt.ts, via `readInstructionFiles`) reads both scopes.
- proposed: A bundle applied for the person reaches a session on either engine, the same as one applied for the project.
- proposed: A bundle is applied for the project, in the workspace's `AGENTS.md`, and there is no person scope.
- proposed: A bundle applied for the person reaches sessions on the own-loop engine only, and a session on the Claude engine carries the project's bundles alone.
- recommended: 1
- because: The person's own notes are already promised to reach the Claude engine the same way as the own loop, so a person-scope bundle that silently stopped at the engine boundary would be the odd one out.
- ruling: no. bundles should only be applied to agents.md. Either in project or user profile.

### The person's memories live only in CLAUDE.md, not AGENTS.md
- on: Content moves whole, Both files already there, Same rules on both engines after the move
- finding: `userMemoryFile` in src/agent/memory/memories.ts hardcodes the person's `## Memories` section to `~/.claude/CLAUDE.md`, and every read, write and forget of a person-scope memory (`memoryPath`, `MemoryContract`, `removeUserMemoryBullet`, `userMemorySection`) targets that one path; moving and removing `CLAUDE.md` would strand an existing person's memories unless that move carries this section to `AGENTS.md` too, which the spec does not say.
- proposed: Accepting the move carries everything the file holds, the person's memories among it, and from then on memories are written to and read from `AGENTS.md`.
- proposed: Accepting the move carries the rest of the file and leaves the person's memories where they are, so `CLAUDE.md` is kept when it holds them.
- proposed: The move is offered for the workspace's file only, and the person's own `CLAUDE.md` is left as it is.
- recommended: 1
- because: It keeps the promise that after the move one file holds the person's rules and notes, with nothing left behind in a file the move has deleted.
- ruling: Accepting the move carries everything the file holds, the person's memories among it, and from then on memories are written to and read from `AGENTS.md`.
