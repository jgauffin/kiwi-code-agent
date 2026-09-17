---
feature: Repo map
status: approved
---

# Repo map

## Goal
A reconcile or implement session starts knowing what the workspace is made of, so it spends its turns on the work instead of on discovering the shape of the repo. A mechanical build walks the workspace and records what it finds: the projects and their paths, the folder conventions the tree actually follows, and, per project, an index of its public types and members. The small part — projects and conventions — is given to the session up front; the type index stays on disk and is read when a session needs a signature, so a large repo costs tool calls it would have spent anyway rather than context it cannot afford. Blind planning never sees any of it.

## Building the map
Run on demand from the command, and by the session start that needs a fresh map.

- **B1**: the command `KiwiAgent: Build Repo Map` writes the map: the workspace's projects — solutions, `.csproj`, `package.json` workspaces — each with its path and kind, and for each project a type index of its public types with their public members, one line each. (docs/features/repo-map.md#Repo map)
  - **E1**: a workspace where no project is recognised still produces a map that states it found none, so the next session start does not rebuild over and over.
- **B2**: the build considers the workspace's source and project files only, skipping the locations the agent's own search tools skip, the agent's generated folder, and — when the workspace has a `.gitignore` — what it ignores; the same set is what "the newest source file" is measured over.
  - **E7**: a workspace with no `.gitignore`, or one that cannot be read, builds normally on the built-in list of skipped locations alone.
- **B3**: the type index of a project comes from the build's own scan of its source for `public` declarations, C# and TypeScript alike; no language service is consulted. (docs/features/repo-map.md#Repo map)
  - **E2**: a file the scan cannot parse is left out of the index and named as skipped there, and does not fail the build.
- **B4**: folder conventions are stated as facts derived from the tree alone, never from any document, and each carries the evidence it rests on ("endpoints live in `src/<Feature>/Endpoint.cs` — 14 of 15"). (docs/features/repo-map.md#Repo map)
  - **E3**: a pattern with too few occurrences, or with counterexamples beyond the threshold, is left out entirely rather than stated with a hedge.
- **B5**: the build runs without an engine: no model call, no tokens, no permission prompt.
- **B6**: the build is deterministic — run twice over an unchanged tree it produces byte-identical files, with ordering that does not depend on filesystem enumeration order.
- **B7**: the build replaces its files wholesale and atomically, and two builds asked for at once (two session starts, or the command during a start) resolve to a single build; no reader ever sees a partly written file.

## Starting a session that needs the map
A reconcile run or an implement session begins, and the map has to be there and current before the first prompt.

- **B8**: a reconcile run and an implement session receive the map's summary as context at their start; a chat session and a plan session do not. (docs/features/repo-map.md#Repo map)
  - **E4**: the map's root is in no plan session's read scope, so its Read and Glob deny it and blindness holds even when a map exists. (docs/intent/agent.md#Phase 1: Blind plan)
- **B9**: when the map is missing or older than the newest source file, the start builds it first and the session's first prompt is held until the build ends; progress is visible while it runs. (docs/features/repo-map.md#Repo map)
  - **E5**: a build that fails, or exceeds its time bound, does not block the start — the session begins with the previous map if there is one and with none if there is not, and says which.
  - **E6**: a session works from the map as it stood when it started and keeps that snapshot for its life — another session's build, or the command, rewriting the map underneath changes nothing it holds; a session set up afresh after its engine stopped counts as a start and takes a new snapshot.
- **B10**: the injected summary is size-bounded — the project list, the folder conventions, and per project the path to its type index and the number of public types in it. Where the bound trimmed the list, the summary states how many projects were left out.

## Reading a project's types
A session that needs an actual signature goes to the index instead of the source.

- **B11**: each project's type index is a file on disk opened by the path the injected summary names, never found by searching; it is readable because the map's root lies within the read scope of every phase that receives the map, and it is not size-capped, since it is read on demand rather than injected.
- **B12**: the retrieval sub-session reads the same index files with its own tools; nothing about the map is injected into it. (docs/intent/agent.md#Retrieval) [removed]
- **B13**: the map's files are generated output: a write into them is not refused, it is lost — the next build rewrites them wholesale, so nothing a session edits there survives.
