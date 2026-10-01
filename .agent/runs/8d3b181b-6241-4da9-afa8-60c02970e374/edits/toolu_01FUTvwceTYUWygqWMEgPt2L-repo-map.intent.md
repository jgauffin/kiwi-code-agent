## A1 (replace) docs/features/repo-map.md#Repo map
- from: ruled in the plan session, when the cost of injecting a public type index was weighed
- why: intent bounded the map by capping the types it lists, which still puts the whole public surface of a large repo into every session's context and hides what was cut. Splitting it — a small injected summary, the type index on disk and read on demand — keeps the context small without losing the surface.

A generated overview of the workspace that reconcile and implement sessions get up front, so they explore less.

- Command `KiwiAgent: Build Repo Map` writes the map under `.agent/`; it also runs before a reconcile or implement session starts when the map is older than the newest source file.
- Two parts. The summary is what a session is given at start: the project list (solutions, `.csproj`, `package.json` workspaces) with paths, the folder conventions found, and per project the path to its type index and the number of public types in it. The type index is one file per project, public types with their public members, one line each, left on disk.
- Only the summary is size-bounded, so it stays a map: a cap on the projects it lists, with a count of what was omitted. A type index is read and searched on demand, so it is not capped.
- For .NET the type index comes from the C# language service when available, otherwise from a Roslyn-free scan of `public` declarations; for TypeScript from the TypeScript language service. Each index says which produced it.
- The summary is injected as context at session start, not read through tools. The type indexes are read through tools, by the session and by the retrieval sub-session alike.
- Chat sessions do not receive the map. Plan sessions cannot reach it: blind planning reads `docs/intent/**` and nothing else.
- Folder conventions are stated as facts ("endpoints live in `src/<Feature>/Endpoint.cs`"), derived from the tree with the evidence they rest on, never from the docs.
- The map is generated output: the build rewrites it wholesale, no session edits it.

Not included: call graphs, cross-project dependency analysis, watching for changes during a session.
