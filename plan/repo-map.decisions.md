# Decisions for Repo map

### F1 [applied]
- on: B11
- finding: a reconcile run cannot read anything under `.agent/`. `ScopeGuard.check` (src/agent/phases/scope-guard.ts) matches the workspace-relative path against the scope's globs, and `reconcileScope` (src/agent/phases/reconcile.ts) gives `readable: ['**']`; `**` does not match a path whose segment starts with a dot, so Read and Grep of `.agent/...` are denied with "this phase is limited to **". The spec should say the index files are reachable only where the phase's scope names their root, so the map's root is added to the reconcile scope (the task, once ruled).
- proposed: Put plainly: B11 assumes that having read tools is the same as being allowed to read the file, and it is not — each phase is given a list of paths its tools may open, and the map's folder is not on the reconcile run's list, so every read of it is refused. The map's content does not change; only the spec's claim about reachability, which should say the map lives where each phase that needs it is permitted to read, and that permission is part of building this feature.

### F2 [applied]
- on: E6
- finding: a session's context is not fixed at its start. `SessionManager.ensureLive` (src/agent/session/session-manager.ts) recreates the engine on the next prompt whenever it stopped — window reload, close, a turn that ended the engine — and `setupFor`/`modeSetup` (src/extension.ts) rebuild the system prompt then, so a resumed reconcile or implement session would be given the map as it stands at that moment and would run the staleness check again. The spec should say what a resumed session gets.
- proposed: Agreed, E6 claims more than intended: it only rules out the map changing under a session mid-flight. Revise E6 to say a running session's map never changes beneath it, and a session set up afresh after its engine stopped is a start — it checks staleness and takes the map as it then stands.

### F3 [applied]
- on: B3
- finding: no language service is reachable from the code as it stands. Nothing under src/agent imports `vscode` (only src/extension.ts and src/chat/*), and `typescript` is a devDependency of a bundled extension (`vsce package --no-dependencies`). The only in-process route is `vscode.executeDocumentSymbolProvider` from the extension layer, which yields an empty result both when no provider is registered and while one is still loading, so "available" cannot be asked. The spec should say an empty or failed answer counts as unavailable and the project falls back, and the user rules whether the TypeScript index is worth bundling `typescript`; the task for the language-service route waits on that ruling.
- proposed: Agreed on availability: revise E2 so a language service counts as available only when it answers, an empty or failed answer being no answer, and that project falls back. On the ruling I propose the scan is the whole of B3 for now and the language-service route is dropped from this feature — it buys fidelity this map does not need and costs a bundled dependency plus a `vscode` reach from the agent layer.

### F4 [applied]
- on: B2
- finding: nothing in the code reads what the workspace ignores. The only shared notion of skipped locations is `IGNORED_DIRS` in src/agent/openai-session/tools/glob.ts (node_modules, .git, bin, obj, dist, out, .vs, .idea), used by glob.ts and grep.ts; no `.gitignore` is parsed anywhere, and `.agent` is not in the set. The spec should say the build skips the same locations the agent's search tools skip, plus `.agent/`, or accept a gitignore reader as new work with no library for it.
- proposed: Agreed, and I propose the first reading: revise B2 to say the build skips what the agent's own search tools skip, plus the agent's generated folder, and drop "what the workspace ignores". A gitignore reader is a separate concern that would change search as much as the map, and one shared notion of where we do not look is worth more than precision here.

### F5 [applied]
- on: B13
- finding: nothing stops a session writing into the map. `modeSetup` (src/extension.ts) gives implement and chat sessions no `ScopeGuard`, and the Allow-writes switch (src/agent/permissions/write-allowance.ts) lets a write through without a prompt; docs/intent/agent.md#Phase 3: Implement says implement has "no scope guard". B13 as written is a property of the build, not a rule the code holds. The spec should say so, or a deny rule on the map's path becomes the task.
- proposed: B13 should stand, reworded rather than enforced: revise it to say an edit into the map is lost at the next build, not refused. A deny rule would be the one scope guard on a phase intent deliberately leaves unguarded, for a file whose content is disposable anyway.

### F6 [applied]
- on: E4
- finding: `blindPlanScope` (src/agent/phases/blind-plan.ts) lets a plan session read `docs/**`, the root README and its own three plan files — not `docs/intent/**` as E4 says, citing docs/intent/agent.md#Phase 1: Blind plan ("Tools: Read/Glob scoped to `docs/intent/**`"), while the same document's Intent write-back section says "Phase 1 is blind: it reads `docs/**` and nothing else". The map stays out of reach on either wording; a test written to E4's wording fails.
- proposed: Agreed, E4 borrowed a scope definition it has no business restating. Revise E4 to state only what this feature owns — the map's root is in no plan-phase read scope, so a plan session cannot reach it — and drop the `docs/intent/**` wording; which docs blind planning reads is that feature's question, not this one's.

### F7 [applied]
- on: B12
- finding: there is no retrieval sub-session. Nothing in src implements `retrieve` or any sub-session other than the reconcile and cleanup child runs (src/chat/chat-view-provider.ts `startMapping`, `startCleanup`), and docs/features/README.md still lists retrieval-subsession.md as left to build. B12 cannot be delivered or proven by this feature; the spec should either drop it or state it as a constraint on the retrieval feature when that is built.
- proposed: Agreed: mark B12 removed. Nothing in this feature can deliver or prove it, and the rule it carries — the sub-session reads the index files, nothing injected — belongs to the retrieval feature, so I would record it as an intent amendment on that feature's doc instead.

### F8 [applied]
- on: B11
- finding: the index files would sit where search cannot reach them. The map's home is `.agent/` — the only generated root the code has (`RunLog.forSession` in src/agent/runs/run-log.ts, `SKILL_ROOTS` in src/agent/skills/skill-index.ts) — and this workspace's `.gitignore` ignores `.agent/`. On the default profile (`kiwiAgent.profiles` in package.json, engine `claude-sdk`) a session's Read/Glob/Grep are Claude Code's own, since `SdkSession` (src/agent/sdk-session/sdk-session.ts) passes tool names only, and those pass over what the workspace ignores; the extension's own `globTool` (src/agent/openai-session/tools/glob.ts) hands the pattern to node's `glob`, which does not match a dot-prefixed segment either. Read by an exact path works; searching the index, which B11 rests on, does not. The spec should say a session opens an index by the path the summary names, or the map should live outside the ignored root.
- proposed: Agreed, and I propose keeping the map in the generated root and revising B11 to say a session opens an index by the path the summary names, dropping "searched" — generated, disposable output does not belong in the tracked tree just to be greppable, and the summary already hands over every path. What that costs is the "which project holds type X" sweep across indexes; the project list and conventions usually answer it, and if they prove not to, a lookup is its own feature rather than a reason to move the files.
