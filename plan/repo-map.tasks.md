---
spec: 29af9fff
---

# Tasks for Repo map

- **T1** (B6, B7, B13): the map's files — layout under `.agent/`, deterministic rendering (sorted, no filesystem enumeration order, no timestamps in the content), wholesale atomic replace via a temp dir and rename, and a single in-flight build two callers share; the test that a build rewrites the files wholesale is also what proves an edit into them is lost (B13). A foundation every other task writes through, so it comes first. [tested]
  - files: src/agent/repo-map/map-files.ts (new), test/repo-map-files.test.ts (new)
  - context: src/agent/runs/run-log.ts, src/agent/skills/skill-index.ts, src/agent/phases/tasks-file.ts, test/run-log.test.ts
  - proves: B6 → test/repo-map-files.test.ts two_builds_over_an_unchanged_tree_write_byte_identical_files, B7 → test/repo-map-files.test.ts a_reader_during_a_build_sees_a_whole_file_never_a_partly_written_one, B13 → test/repo-map-files.test.ts a_build_replaces_the_map_wholesale_so_an_edit_into_it_is_lost
  - note: the swap is per-file rename out of a staging dir rather than a directory rename, so the map root never vanishes between builds; Windows refuses a rename while a reader holds the file, so the build retries briefly.
- **T2** (B2, E7): walk the workspace once — source and project files only, skipping what the agent's search tools skip plus `.agent/`, and what a `.gitignore` names where one exists, falling back to the built-in list alone when it is missing or unreadable — returning both the file set and the newest source mtime the staleness check uses. The gitignore reader is new work with no library behind it, so it is part of this task and not a fourth caller's problem. [tested]
  - files: src/agent/repo-map/workspace-scan.ts (new), test/repo-map-scan.test.ts (new)
  - context: src/agent/openai-session/tools/glob.ts, src/agent/openai-session/tools/grep.ts, src/agent/cleanup/oversized.ts, test/oversized.test.ts
  - proves: B2 → test/repo-map-scan.test.ts only_source_and_project_files_are_scanned_skipping_search_skips_the_agent_folder_and_what_gitignore_names, E7 → test/repo-map-scan.test.ts a_workspace_with_no_gitignore_or_an_unreadable_one_scans_on_the_built_in_skips_alone
  - note: the gitignore reader takes the workspace root's `.gitignore` only — nested ones are not part of what the spec asks for.
- **T3** (B3, E2): the type index per project from the build's own scan of the source for `public` declarations, C# and TypeScript alike — public types with their public members, one line each — with a file the scan cannot parse left out, named as skipped in the index, and not failing the build. No language service is consulted. [tested]
  - files: src/agent/repo-map/type-index.ts (new), test/repo-map-type-index.test.ts (new)
  - context: src/agent/cleanup/unit-size.ts, src/agent/cleanup/language.ts, src/agent/cleanup/strip-literals.ts, test/unit-size.test.ts, test/fixtures-units/sample.cs
  - proves: B3 → test/repo-map-type-index.test.ts public_types_and_their_public_members_come_from_the_scan_of_csharp_and_typescript_source, E2 → test/repo-map-type-index.test.ts a_file_the_scan_cannot_parse_is_left_out_named_as_skipped_and_does_not_fail_the_build
  - note: "cannot parse" is unbalanced braces once literals are stripped, binary content, or a language the scan does not read; TypeScript's `export` is what `public` means there.
- **T4** (B4, E3): folder conventions from the tree alone, each stated as a fact with the evidence it rests on, and a threshold that leaves a thin or contradicted pattern out entirely rather than hedged. [tested]
  - files: src/agent/repo-map/conventions.ts (new), test/repo-map-conventions.test.ts (new)
  - context: src/agent/repo-map/workspace-scan.ts, src/agent/openai-session/tools/glob.ts
  - proves: B4 → test/repo-map-conventions.test.ts a_convention_is_a_fact_from_the_tree_with_the_count_it_rests_on, E3 → test/repo-map-conventions.test.ts a_pattern_with_too_few_files_or_with_counterexamples_past_the_threshold_is_left_out_entirely
  - note: the threshold is three files and four fifths of the subject's files following the pattern; families are exact names, name suffixes and extensions.
- **T5** (B10, B11): render the summary — project list, conventions, per project the path to its type index and its public type count — bounded in size and stating how many projects the bound left out; the index files themselves stay uncapped on disk. Only the rendering side of B11 here: whether a session can reach those paths is F1 and F8, ruled first. [tested]
  - files: src/agent/repo-map/summary.ts (new), test/repo-map-summary.test.ts (new)
  - context: src/agent/repo-map/type-index.ts, src/agent/phases/implement.ts, src/agent/phases/reconcile.ts
  - proves: B10 → test/repo-map-summary.test.ts where_the_bound_trimmed_the_project_list_the_summary_states_how_many_were_left_out, B11 → test/repo-map-summary.test.ts the_summary_stays_bounded_while_the_type_index_it_points_at_is_not_capped
  - note: the bound is 4000 characters and bites from the smallest project up, so the projects with the most public types are the ones the summary keeps.
- **T6** (B1, E1, B5): the build itself — projects (solutions, `.csproj`, `package.json` workspaces) with path and kind, the pieces above assembled and written through T1, a workspace where nothing is recognised still producing a map that says so — and the `KiwiAgent: Build Repo Map` command that runs it host-side, with no engine, tokens or permission prompt. [tested]
  - files: src/agent/repo-map/build-map.ts (new), test/repo-map-build.test.ts (new), src/extension.ts, src/chat/chat-view-provider.ts, package.json
  - context: src/agent/phases/verification.ts, src/agent/phases/migrate-plan.ts, src/agent/repo-map/map-files.ts, src/agent/repo-map/workspace-scan.ts
  - proves: B1 → test/repo-map-build.test.ts the_build_lists_the_workspaces_projects_with_path_and_kind_and_writes_a_type_index_for_each, E1 → test/repo-map-build.test.ts a_workspace_where_no_project_is_recognised_still_gets_a_map_that_states_it_found_none, B5 → test/repo-map-build.test.ts the_build_runs_host_side_with_no_engine_no_tokens_and_no_permission_prompt
  - note: a project owns the source under its folder that no project nested deeper owns; a solution owns none, since its projects do.
- **T7** (B8, B9, E4, E5, E6): session start — a reconcile run and an implement session get the summary with their phase prompt while a chat or plan session does not, the plan phase's scope still denying the map's root (E4); a missing or stale map is built before the first prompt, which waits on it, with progress shown; a build that fails or passes its time bound lets the start through on the previous map or none, saying which; the summary a session starts with is held for its life, and a session set up afresh after its engine stopped takes a new one. Note the vocabulary already in use: `mappings`, `startMapping` and `PlanState.mapping` mean the reconcile run, so name the new run state after the repo map, not "mapping". [tested]
  - files: src/agent/repo-map/session-context.ts (new), test/repo-map-session-context.test.ts (new), src/extension.ts, src/agent/phases/reconcile.ts
  - context: src/agent/session/session-manager.ts, src/agent/phases/reconcile.ts, src/agent/phases/implement.ts, src/agent/phases/blind-plan.ts, src/agent/phases/scope-guard.ts, src/chat/webview/plan-bar.ts, test/scope-guard.test.ts
  - proves: B8 → test/repo-map-session-context.test.ts a_reconcile_run_and_an_implement_session_get_the_summary_while_a_chat_or_plan_session_does_not, B9 → test/repo-map-session-context.test.ts a_missing_or_stale_map_is_built_before_the_first_prompt_with_progress_shown, E4 → test/repo-map-session-context.test.ts the_maps_root_is_in_no_plan_sessions_read_scope_while_the_reconcile_scope_names_it, E5 → test/repo-map-session-context.test.ts a_build_that_fails_or_passes_its_time_bound_still_starts_the_session_saying_which_map_it_has, E6 → test/repo-map-session-context.test.ts the_summary_a_session_starts_with_is_held_for_its_life_and_a_fresh_start_takes_a_new_one
  - note: the snapshot is the system prompt string built in `setupFor` at engine creation, so E6 needs no extra holder; F1's fix is `reconcileScope` naming `.agent/repo-map/**` beside `**`, and the progress the start shows is a window-location `withProgress` — the chat webview and its protocol needed nothing, so they left the files line.

## Verification
- 2026-09-15T06:53:01.640Z: failed, `npm run typecheck && npm test && npm run build` in .
