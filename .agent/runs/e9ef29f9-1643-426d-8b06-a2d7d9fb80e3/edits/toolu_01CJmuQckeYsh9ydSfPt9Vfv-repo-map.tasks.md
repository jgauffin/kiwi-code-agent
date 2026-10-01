---
spec: 76dcd783
---

# Tasks for Repo map

- T1 (B6, B7, B13): the map's files — layout under `.agent/`, deterministic rendering (sorted, no filesystem enumeration order, no timestamps in the content), wholesale atomic replace via a temp dir and rename, and a single in-flight build two callers share; the test that a build rewrites the files wholesale is also what proves an edit into them is lost (B13). A foundation every other task writes through, so it comes first. [tested]
  - files: src/agent/repo-map/map-files.ts (new), test/repo-map-files.test.ts (new)
  - context: src/agent/runs/run-log.ts, src/agent/skills/skill-index.ts, src/agent/phases/tasks-file.ts, test/run-log.test.ts
  - proves: B6 test/repo-map-files.test.ts two_builds_over_an_unchanged_tree_write_byte_identical_files, B7 test/repo-map-files.test.ts a_reader_during_a_build_sees_a_whole_file_never_a_partly_written_one, B13 test/repo-map-files.test.ts a_build_replaces_the_map_wholesale_so_an_edit_into_it_is_lost
  - note: the swap is per-file rename out of a staging dir rather than a directory rename, so the map root never vanishes between builds; Windows refuses a rename while a reader holds the file, so the build retries briefly.
- T2 (B2, E7): walk the workspace once — source and project files only, skipping what the agent's search tools skip plus `.agent/`, and what a `.gitignore` names where one exists, falling back to the built-in list alone when it is missing or unreadable — returning both the file set and the newest source mtime the staleness check uses. The gitignore reader is new work with no library behind it, so it is part of this task and not a fourth caller's problem. [tested]
  - files: src/agent/repo-map/workspace-scan.ts (new), test/repo-map-scan.test.ts (new)
  - context: src/agent/openai-session/tools/glob.ts, src/agent/openai-session/tools/grep.ts, src/agent/cleanup/oversized.ts, test/oversized.test.ts
  - proves: B2 test/repo-map-scan.test.ts only_source_and_project_files_are_scanned_skipping_search_skips_the_agent_folder_and_what_gitignore_names, E7 test/repo-map-scan.test.ts a_workspace_with_no_gitignore_or_an_unreadable_one_scans_on_the_built_in_skips_alone
  - note: the gitignore reader takes the workspace root's `.gitignore` only — nested ones are not part of what the spec asks for.
- T3 (B3, E2): the type index per project from the build's own scan of the source for `public` declarations, C# and TypeScript alike — public types with their public members, one line each — with a file the scan cannot parse left out, named as skipped in the index, and not failing the build. No language service is consulted.
  - files: src/agent/repo-map/type-index.ts (new), test/repo-map-type-index.test.ts (new)
  - context: src/agent/cleanup/unit-size.ts, src/agent/cleanup/language.ts, src/agent/cleanup/strip-literals.ts, test/unit-size.test.ts, test/fixtures-units/sample.cs
- T4 (B4, E3): folder conventions from the tree alone, each stated as a fact with the evidence it rests on, and a threshold that leaves a thin or contradicted pattern out entirely rather than hedged.
  - files: src/agent/repo-map/conventions.ts (new), test/repo-map-conventions.test.ts (new)
  - context: src/agent/repo-map/workspace-scan.ts, src/agent/openai-session/tools/glob.ts
- T5 (B10, B11): render the summary — project list, conventions, per project the path to its type index and its public type count — bounded in size and stating how many projects the bound left out; the index files themselves stay uncapped on disk. Only the rendering side of B11 here: whether a session can reach those paths is F1 and F8, ruled first.
  - files: src/agent/repo-map/summary.ts (new), test/repo-map-summary.test.ts (new)
  - context: src/agent/repo-map/type-index.ts, src/agent/phases/implement.ts, src/agent/phases/reconcile.ts
- T6 (B1, E1, B5): the build itself — projects (solutions, `.csproj`, `package.json` workspaces) with path and kind, the pieces above assembled and written through T1, a workspace where nothing is recognised still producing a map that says so — and the `KiwiAgent: Build Repo Map` command that runs it host-side, with no engine, tokens or permission prompt.
  - files: src/agent/repo-map/build-map.ts (new), test/repo-map-build.test.ts (new), src/extension.ts, src/chat/chat-view-provider.ts, package.json
  - context: src/agent/phases/verification.ts, src/agent/phases/migrate-plan.ts, src/agent/repo-map/map-files.ts, src/agent/repo-map/workspace-scan.ts
- T7 (B8, B9, E4, E5, E6): session start — a reconcile run and an implement session get the summary with their phase prompt while a chat or plan session does not, the plan phase's scope still denying the map's root (E4); a missing or stale map is built before the first prompt, which waits on it, with progress shown; a build that fails or passes its time bound lets the start through on the previous map or none, saying which; the summary a session starts with is held for its life, and a session set up afresh after its engine stopped takes a new one. Note the vocabulary already in use: `mappings`, `startMapping` and `PlanState.mapping` mean the reconcile run, so name the new run state after the repo map, not "mapping".
  - files: src/agent/repo-map/session-context.ts (new), test/repo-map-session-context.test.ts (new), src/extension.ts, src/chat/chat-view-provider.ts, src/chat/protocol.ts
  - context: src/agent/session/session-manager.ts, src/agent/phases/reconcile.ts, src/agent/phases/implement.ts, src/agent/phases/blind-plan.ts, src/agent/phases/scope-guard.ts, src/chat/webview/plan-bar.ts, test/scope-guard.test.ts
