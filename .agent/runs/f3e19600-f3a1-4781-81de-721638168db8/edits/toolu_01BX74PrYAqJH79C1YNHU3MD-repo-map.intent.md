## A1 (replace) docs/features/repo-map.md#Repo map
- from: ruled in the plan session, when the cost of injecting a public type index was weighed
- why: intent bounded the map by capping the types it lists, which still puts the whole public surface of a large repo into every session's context and hides what was cut. Splitting it — a small injected summary, the type index on disk and read on demand — keeps the context small without losing the surface.

A generated overview of the workspace that reconcile and implement sessions get up front, so they explore less.

- Command `KiwiAgent: Build Repo Map` writes the map under `.agent/`; it also runs before a reconcile or implement session starts when the map is older than the newest source file.
- Two parts. The summary is what a session is given at start: the project list (solutions, `.csproj`, `package.json` workspaces) with paths, the folder conventions found, and per project the path to its type index and the number of public types in it. The type index is one file per project, public types with their public members, one line each, left on disk.
- Only the summary is size-bounded, so it stays a map: a cap on the projects it lists, with a count of what was omitted. A type index is read and searched on demand, so it is not capped.
- The type index comes from the build's own scan of the source for `public` declarations, C# and TypeScript alike. No language service is consulted.
- The summary is injected as context at session start, not read through tools. The type indexes are read through tools, by the session and by the retrieval sub-session alike.
- A session works from the map as it stood when it started: a build by another session does not change what a running session holds.
- Chat sessions do not receive the map. Plan sessions cannot reach it: the map lies outside what blind planning may read.
- Folder conventions are stated as facts ("endpoints live in `src/<Feature>/Endpoint.cs`"), derived from the tree with the evidence they rest on, never from the docs.
- The map is generated output: the build rewrites it wholesale, no session edits it.

Not included: call graphs, cross-project dependency analysis, watching for changes during a session.

## A2 (append) docs/intent/agent.md#Phase 2: Map against code
- from: F1 (naive)
- why: intent says the mapping run sees the repo, but the agent's own generated folder is not part of the repo as its file scope understands it, so generated context it is meant to use is out of reach.

The mapping run reads the agent's own generated files as well as the workspace: what a build wrote for it to use is part of what it may read.

## A3 (append) docs/intent/agent.md#Shape
- from: F2 (naive)
- why: intent treats a session as set up once, but a session whose engine stopped is set up again from scratch when the next prompt arrives, with the instructions and context of a session starting now.

A session that is picked up after its engine stopped is set up afresh: it carries the conversation it had, and the instructions and generated context a session starting now would get.

## A4 (append) docs/features/repo-map.md#Repo map
- from: F3 (naive)
- why: intent says the type index comes from the language service "when available", and availability cannot be asked: a language service that is missing, still loading or failing all answer the same way, with nothing.

The type index is the agent's own, produced by scanning the source. A language service is not consulted, because it cannot be asked whether it is there: one that is absent, one still loading and one that failed all answer alike.

## A5 (append) docs/features/repo-map.md#Repo map
- from: F4 (naive)
- why: intent speaks of generated and ignored locations without saying which, and the product has only one notion of where it does not look.

The build looks where the agent's own search looks: it passes over dependency folders, build output and the agent's own generated folder. Where the workspace states what it ignores, that is passed over too; where it does not, the agent's own list stands on its own.

## A6 (append) docs/intent/agent.md#Phase 3: Implement
- from: F5 (naive)
- why: intent says both that no session edits the generated map and that the implement phase has no scope guard; nothing refuses such an edit.

An implement session may write anywhere the user allows, generated files included. What protects generated output is that the next build rewrites it wholesale: an edit into it is lost, not refused.
