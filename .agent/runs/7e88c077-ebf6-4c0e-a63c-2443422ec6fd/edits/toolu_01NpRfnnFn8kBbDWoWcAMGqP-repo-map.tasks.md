---
spec: 7691a5ea
---

# Tasks for Repo map

- T1 (B6, B7): the map's files — layout under `.agent/`, deterministic rendering (sorted, no filesystem enumeration order, no timestamps), wholesale atomic replace into a temp dir and rename, and a single in-flight build two callers share. A foundation every other task writes through, so it comes first.
  - files: src/agent/repo-map/map-files.ts (new), test/repo-map-files.test.ts (new)
  - context: src/agent/runs/run-log.ts, src/agent/skills/skill-index.ts, src/agent/phases/tasks-file.ts, test/run-log.test.ts
- T2 (B2): walk the workspace once — source and project files only, skipping `.agent/`, build output and dependency folders — and return both the file set and the newest source mtime the staleness check uses.
  - files: src/agent/repo-map/workspace-scan.ts (new), test/repo-map-scan.test.ts (new)
  - context: src/agent/openai-session/tools/glob.ts, src/agent/openai-session/tools/grep.ts, src/agent/cleanup/oversized.ts
- T3 (B3, E2): the type index per project from a scan of `public` declarations — public types with their public members, one line each — behind a symbol-source port so a source that is absent or fails falls back to the scan and the index states which produced it. Only the scan side; the language-service side waits on F3.
  - files: src/agent/repo-map/type-index.ts (new), test/repo-map-type-index.test.ts (new)
  - context: src/agent/cleanup/unit-size.ts, src/agent/cleanup/language.ts, src/agent/cleanup/strip-literals.ts, test/unit-size.test.ts
- T4 (B4, E3): folder conventions from the tree alone, each with its evidence, and a threshold that leaves a thin or contradicted pattern out entirely.
  - files: src/agent/repo-map/conventions.ts (new), test/repo-map-conventions.test.ts (new)
  - context: src/agent/openai-session/tools/glob.ts, docs/features/repo-map.md
- T5 (B10, B11): render the summary — project list, conventions, per project the path to its type index and its public type count — bounded in size with a count of the projects left out; the index files themselves stay uncapped on disk.
  - files: src/agent/repo-map/summary.ts (new), test/repo-map-summary.test.ts (new)
  - context: src/agent/phases/implement.ts, src/agent/phases/verification.ts, docs/features/repo-map.md
- T6 (B1, E1, B5): the build itself — projects (solutions, `.csproj`, `package.json` workspaces) with path and kind, the pieces above assembled and written, a workspace with no project recognised still producing a map that says so — and the `KiwiAgent: Build Repo Map` command that runs it host-side, with no engine, tokens or permission prompt.
  - files: src/agent/repo-map/build-map.ts (new), test/repo-map-build.test.ts (new), src/extension.ts, package.json
  - context: src/agent/phases/verification.ts, src/agent/phases/migrate-plan.ts, src/chat/chat-view-provider.ts, src/agent/session/session-manager.ts
- T7 (B8, B9, E5): session start — a reconcile run and an implement session get the summary with their phase prompt, a chat or plan session does not; a missing or stale map is built first and the first prompt waits on it, with progress shown and a time bound past which the start goes ahead on the previous map, or none, and says which.
  - files: src/agent/repo-map/session-context.ts (new), test/repo-map-session-context.test.ts (new), src/extension.ts, src/chat/chat-view-provider.ts, src/chat/protocol.ts
  - context: src/agent/session/session-manager.ts, src/agent/phases/reconcile.ts, src/agent/phases/implement.ts, src/agent/phases/blind-plan.ts, src/chat/webview/plan-bar.ts
