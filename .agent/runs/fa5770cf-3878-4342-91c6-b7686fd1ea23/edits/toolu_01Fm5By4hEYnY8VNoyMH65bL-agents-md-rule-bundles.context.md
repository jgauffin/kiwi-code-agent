# Where Agents.md rule bundles is built

## Rules that became optional
- src/agent/session/mode-setup.ts — decides, per mode, whether a session gets the engine's own instruction-file reading or a fully custom prompt; where a mode's bundle rules (or lack of them) are wired in
- src/session-engines.ts — `startClaude`/`startOpenAi`: builds each engine's `systemPrompt`/`appendSystemPrompt`/`settingSources`, the join point between a mode's own prompt and the instruction files
- src/agent/instructions/instruction-files.ts — `instructionFilePaths`/`readInstructionFiles`: the CLAUDE.md/AGENTS.md paths read today, global then workspace
- src/agent/openai-session/system-prompt.ts — `buildSystemPrompt`: where instruction files join the OpenAI-engine chat prompt
- src/agent/sdk-session/sdk-session.ts — `buildOptions`: where the Claude engine's own CLAUDE.md/AGENTS.md reading is configured (`settingSources`, `appendSystemPrompt`)
- src/agent/phases/implement.ts — `implementPrompt`: where implement's own core-behaviour text (doc/code reading, spec contract) is already baked in by phase, the model bundles would join or be kept separate from
- docs/intent/agent.md#Instructions — cited rule source for core behaviour and the blind planner carrying no bundles

## Picking up bundles for a workspace
- src/settings/settings-store.ts — existing user/workspace setting-scope model (`SettingKey` → `'user' | 'workspace'`) a bundle's project/person scope would extend
- src/settings/protocol.ts — `SettingsTarget` and the settings webview protocol a bundles tab would plug into
- src/settings/webview — existing tab pattern (profiles-tab.ts, providers-tab.ts, memories-tab.ts) for a management UI listing/applying/removing bundles
- src/agent/instructions/instruction-files.ts — where an applied bundle's marked block would be written into AGENTS.md
- src/agent/memory/memories.ts — prior art for one marked, independently-editable section inside an instructions file (`## Memories`, `removeUserMemoryBullet`)

## Where bundles come from
- src/agent/mcp/mcp-config.ts — existing pattern for a source merging user and workspace configuration (`~/.mcp.json` plus the workspace's `.mcp.json`), closest existing analogue to a bundle source list
- src/settings/settings-store.ts — where a new `kiwiAgent.bundleSources`-like setting would be declared, user- and workspace-scoped

## Moving from CLAUDE.md to AGENTS.md
- src/agent/instructions/instruction-files.ts — `instructionFilePaths`: every CLAUDE.md/AGENTS.md location a move must account for, at both the user and workspace level
- src/agent/memory/memories.ts — `userMemoryFile`: the person's memory section lives inside CLAUDE.md specifically today and must be carried if the file moves
- src/agent/memory/session-context.ts — reads `userMemoryFile`/`userMemorySection` at session start; depends on the memory section staying findable after a move
