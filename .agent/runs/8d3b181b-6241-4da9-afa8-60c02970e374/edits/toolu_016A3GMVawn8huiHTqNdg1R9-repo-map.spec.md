---
feature: Repo map
status: draft
---

# Repo map

## Goal
A reconcile or implement session starts knowing what the workspace is made of, so it spends its turns on the work instead of on discovering the shape of the repo. A mechanical build walks the workspace and records what it finds: the projects and their paths, the folder conventions the tree actually follows, and, per project, an index of its public types and members. The small part — projects and conventions — is given to the session up front; the type index stays on disk and is read when a session needs a signature, so a large repo costs tool calls it would have spent anyway rather than context it cannot afford. Blind planning never sees any of it.

## Building the map
Run on demand from the command, and by the session start that needs a fresh map.

- B1 (docs/features/repo-map.md#Repo map): the command `KiwiAgent: Build Repo Map` writes the map: the workspace's projects — solutions, `.csproj`, `package.json` workspaces — each with its path and kind, and for each project a type index of its public types with their public members, one line each.
  - E1: a workspace where no project is recognised still produces a map that states it found none, so the next session start does not rebuild over and over.
- B2: the build considers the workspace's source and project files only, skipping generated and ignored locations (`.agent/`, build output, dependency folders, what the workspace ignores); the same set is what "the newest source file" is measured over.
- B3 (docs/features/repo-map.md#Repo map): the .NET type index comes from the C# language service when it is available and from a scan of `public` declarations when it is not; the TypeScript index comes from the TypeScript language service. Each project's index states which of the two produced it.
  - E2: a language service that is absent, not yet loaded or fails is not a build failure — that project falls back and the build completes.
- B4 (docs/features/repo-map.md#Repo map): folder conventions are stated as facts derived from the tree alone, never from any document, and each carries the evidence it rests on ("endpoints live in `src/<Feature>/Endpoint.cs` — 14 of 15").
  - E3: a pattern with too few occurrences, or with counterexamples beyond the threshold, is left out entirely rather than stated with a hedge.
- B5: the build runs without an engine: no model call, no tokens, no permission prompt.
- B6: the build is deterministic — run twice over an unchanged tree it produces byte-identical files, with ordering that does not depend on filesystem enumeration order.
- B7: the build replaces its files wholesale and atomically, and two builds asked for at once (two session starts, or the command during a start) resolve to a single build; no reader ever sees a partly written file.

## Starting a session that needs the map
A reconcile run or an implement session begins, and the map has to be there and current before the first prompt.

- B8 (docs/features/repo-map.md#Repo map): a reconcile run and an implement session receive the map's summary as context at their start; a chat session and a plan session do not.
  - E4 (docs/intent/agent.md#Phase 1: Blind plan): a plan session cannot reach the map's files at all — its Read and Glob stay scoped to `docs/intent/**` — so blindness holds even if a map exists.
- B9 (docs/features/repo-map.md#Repo map): when the map is missing or older than the newest source file, the start builds it first and the session's first prompt is held until the build ends; progress is visible while it runs.
  - E5: a build that fails, or exceeds its time bound, does not block the start — the session begins with the previous map if there is one and with none if there is not, and says which.
  - E6: a build that finishes while a session is already running does not alter what that session was given; the map a session holds is the one it started with.
- B10: the injected summary is size-bounded — the project list, the folder conventions, and per project the path to its type index and the number of public types in it. Where the bound trimmed the list, the summary states how many projects were left out.

## Reading a project's types
A session that needs an actual signature goes to the index instead of the source.

- B11: each project's type index is a file on disk whose path the injected summary names, readable with the session's ordinary read and search tools; it is not size-capped, because it is read on demand and searched, not injected.
- B12 (docs/intent/agent.md#Retrieval): the retrieval sub-session reads the same index files with its own tools; nothing about the map is injected into it.
- B13: the map's files are generated output, never a session's to edit — the next build rewrites them completely, so an edit made into them does not survive.
