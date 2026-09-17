# Repo map

A generated overview of the workspace that reconcile and implement sessions get up front, so they explore less.

- Command `KiwiAgent: Build Repo Map` writes the map under `.agent/`; it also runs before a reconcile or implement session starts when the map is older than the newest source file.
- Two parts. The summary is what a session is given at start: the project list (solutions, `.csproj`, `package.json` workspaces) with paths, the folder conventions found, and per project the path to its type index and the number of public types in it. The type index is one file per project, public types with their public members, one line each, left on disk.
- Only the summary is size-bounded, so it stays a map: a cap on the projects it lists, with a count of what was omitted. A type index is read and searched on demand, so it is not capped.
- The type index comes from the build's own scan of the source for `public` declarations, C# and TypeScript alike. No language service is consulted, because it cannot be asked whether it is there: one that is absent, one still loading and one that failed all answer alike.
- The summary is injected as context at session start, not read through tools. The type indexes are read through tools, by the session and by the retrieval sub-session alike.
- A session opens a type index by the path the summary gives it. Generated output lies where the workspace tells search to pass over, so it is reached by being named, never by being searched for.
- The build looks where the agent's own search looks: it passes over dependency folders, build output and the agent's own generated folder. Where the workspace states what it ignores, that is passed over too; where it does not, the agent's own list stands on its own.
- A session works from the map as it stood when it started: a build by another session does not change what a running session holds.
- Chat sessions do not receive the map. Plan sessions cannot reach it: the map lies outside what blind planning may read.
- Folder conventions are stated as facts ("endpoints live in `src/<Feature>/Endpoint.cs`"), derived from the tree with the evidence they rest on, never from the docs.
- The map is generated output: the build rewrites it wholesale, no session edits it.

Not included: call graphs, cross-project dependency analysis, watching for changes during a session.
