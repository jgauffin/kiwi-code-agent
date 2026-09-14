# Repo map

A generated overview of the workspace that reconcile and implement sessions get up front, so they explore less.

- Command `KiwiAgent: Build Repo Map` writes `.agent/repo-map.md`; it also runs before a reconcile or implement session starts when the file is older than the newest source file.
- Contents: the project list (solutions, `.csproj`, `package.json` workspaces) with paths; per project the public types and their members, one line each; the folder conventions found (test projects, where endpoints, domain models and migrations live).
- For .NET the type index comes from the C# language service when available, otherwise from a Roslyn-free scan of `public` declarations; for TypeScript from the TypeScript language service.
- Size-bounded: a per-project cap on listed types, and a total cap, with counts of what was omitted, so the map stays a map.
- The map is injected as context at session start, not read through tools, and is also readable by the retrieval sub-session.
- Folder conventions are stated as facts ("endpoints live in `src/<Feature>/Endpoint.cs`"), derived from the tree, never from the docs.

Not included: call graphs, cross-project dependency analysis, watching for changes during a session.
