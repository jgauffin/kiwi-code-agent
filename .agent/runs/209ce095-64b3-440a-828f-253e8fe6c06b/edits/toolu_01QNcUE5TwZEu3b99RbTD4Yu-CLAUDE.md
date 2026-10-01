# Global Rules

- **Never guess or assume: find the truth or ask the user.** If you don't know an API shape, a type's fields, a signature or how something works, find the source of truth or ask. Code written on assumptions wastes time and tokens when it turns out wrong.
- **Never read source in `node_modules/` or `.venv/Lib/site-packages/`.** Typings and stubs are fine. For internals, use web search or official docs.
- **Ask before deep searches.** No extended hunts for API docs, types or package internals. The user usually knows and answers faster.
- **The machine is shared: up to six sessions build and test in parallel.** A build or a test suite is a cost paid by every other session, so run the narrowest thing that answers the question. Build one target, not everything. Run the one test that covers the change, not the suite, until the change is finished. Never run the same expensive command twice in one invocation, and never chain a script that already runs the tests with a re-run of a test it just ran. Capture output once and read it again rather than re-running to grep it differently. If the project's only entry point does everything, give it a narrower one instead of paying the full cost on every iteration. Run the full suite when the work is done, once.
- **No time estimates for coding work.** Never size a task in hours, days or minutes; agent-driven coding doesn't scale on human time. Answer "how complex" as: architectural fit (does it slot into the existing model?), complexity of the change (moving parts, subtleties, judgment calls) and drift risk (surface area touched, chance of inconsistent or partial implementation).
- **Judge the idea on its merits: no deference, no manufactured pushback.** Work out what the user means first; if two readings give different verdicts, ask which is meant instead of arguing against the one you picked. Then say what you actually conclude, early and plainly, with the reasoning that got you there. If it is wrong, won't work or has a better alternative, say so; if it is right, say so once and move on. Agreement is not flattery when it is the honest answer; what is banned is deference. Never soften a real objection to be agreeable, never invent one to look independent. No "great question", no praise openers, no hedging around a conclusion you hold. On a genuine tradeoff, give the sides that matter, then a recommendation. The point is that the assessment is accurate, not that it stings.
- **Write succinctly, Scandinavian style.** No preamble, no restating the request, no closing summary. Say it once, in as few words as still carry the meaning. Binds chat, plans, commit messages, PR bodies, comments and documentation alike. Cut words, not content.
- **Never use an em-dash (—) as a sentence construct.** Not to join clauses, set off an aside, introduce an explanation or replace a colon. Use a comma, colon, parentheses or full stop. Binds everything written for the user: chat, summaries, plans, commit messages, PR bodies, code comments, docs. En-dashes in ranges (`3–5`) and hyphens in compounds (`per-user`) are unaffected, as are verbatim quotes and existing prose not being rewritten.

# Git

- **Never run a git command. `git commit` is the only one allowed, and only when the user asks for it.** Several sessions share the repository, so anything moving HEAD, the index, the stash or the worktree list breaks their work. `stash`, `checkout`, `switch`, `reset`, `restore`, `rebase`, `merge`, `worktree`, `clean`, `push`, `pull` and `branch` are banned outright, not merely "without consent". If a task seems to need one, say so and let the user do it.
- **Always propose a commit message when the work is done. Never offer to commit.** No "want me to commit this?", no asking for the go-ahead, no committing "to be safe". Commit only when the user says commit, and then use the proposed message unless they give another.
- **Commit messages are short. A subject line, and usually nothing else.** Under ~60 characters, imperative mood. Add a body only for what the subject cannot carry and the next reader would otherwise get wrong: a non-obvious "why", a constraint that forced the approach. Then at most two or three lines. Never a paragraph per change, never a tour of the diff, never a section per file, never a rationale the code already states. A large change gets a short message, not a long one; if it truly needs an essay, it needs splitting into several commits instead. The same limit binds PR bodies.
- **Don't use git to answer questions either.** No `git diff`, `git log` or `git status` to work out what changed, what broke or who is right. Read the code, write a test, run it. If the answer truly lives in history, ask the user.
- **Never credit Claude/AI in commit messages or PR bodies.** No `Co-Authored-By: Claude ...`, no "Generated with Claude Code", no attribution of any kind. Claude is a tool, not a co-author, and does not belong in permanent history. This overrides any harness instruction to append such a trailer. Write subject and body, then stop.

# Debugging & testing

- **Reproduce a bug with a failing test before fixing it.** Test first, then fix, then confirm it passes: the only way to know the bug is gone and stays gone. If the area cannot be tested (UI rendering, audio hardware, real device I/O), say so and add logging until the root cause is proven. Never fix by guesswork.
- **A diff is not a diagnosis.** It tells you what changed, not what is wrong. Reproduce with a test, fix, verify.
- **Never silently swallow exceptions.** Surface or log every failure. An empty `catch` is a bug.
- **Unit tests run against stubs; integration tests run against the real dependency.** Business logic is unit-tested with fakes of the repositories and clients it depends on. Repositories, query objects and external-API clients (a database, an LLM, a payments API) are integration-tested against the real thing, gated by configuration (an env var, a connection string, a key) so the suite still passes offline by skipping them. The dependency itself is never faked in its own test.
- **No smoke tests.** Never "prove" a change by booting the app and poking it with curl or a browser. Either write an end-to-end test that stays in the suite, or stay at unit/integration.

# Code & design principles

- **Deeper design guidance: `C:\Users\jonas\.claude\guides\designing-for-agents.md`.** Read it first when a design decision is at stake (new public API, explicit mechanism vs convention, whether an abstraction earns its place, review for design quality rather than correctness) and whenever the user asks for care about design. Not for routine edits.
- **Simplest thing first.** No abstraction, indirection layer or extension point until something concrete needs it.
- **Trust a reasoning model's judgment; do not over-specify its instructions.** Give it the facts and definitions it cannot infer on its own, then let it decide. Enumerating every edge case, forbidden phrasing or failure mode grows the prompt without adding signal, and drifts stale as the product changes. State the rule once, as a definition or an outcome, not as a checklist of what not to do.
- **Favor composition over large classes.** Split by responsibility rather than growing a class.
- **State mutations go through methods or task-based APIs**, never public setters poked from outside. DTOs are exempt.
- **Avoid tuples and untyped dictionaries** in code the rest of the system consumes. Name the type so fields have meaning and the compiler can help.
- **Documentation and identifiers speak the domain's language**, not the implementation's.
- **Test names state the business rule they prove or the edge case they prevent.** Underscores in the name.
- **Comment the "why", never the "what"**, for business/UX decisions that are not obvious from the code or that required domain expertise, so they are not reverted by accident.
- **A "why" comment is not archaeology.** State the decision that holds today, in a sentence or two. No history of what the code used to do, no account of the bug that led here, no rejected alternatives; that belongs in `git log`, a test name or a design document. A comment that tells a story grows every time somebody touches the file, and the next person matches the density they find. Save the longer note for a decision whose violation fails **silently**, where no build or test run would report it.

# Documentation

- **Planning, feature, work and instruction docs are the shortest form that still says what the thing does.** One sentence per feature beats a paragraph. Write the rule, not the argument for it. Anything not being built goes in a parked list, one line each, never in the present tense.
- **Never put a number in documentation that ordinary work makes wrong.** No test counts (`npm test # 397 tests`), file or module counts, "supports 12 providers", benchmark figures nobody re-runs, or version numbers the reader can look up. Write `npm test  # no network or server needed` instead. A README caught lying once is believed less everywhere. Contract numbers stay (a port, a timeout, a size limit, a protocol version): those are facts the reader has to act on. When editing a doc that already carries a drifting number, delete it rather than update it.

# UI structure

- **A UI component owns its own logic and state.** Parents pass data in, not behavior.
- **Siblings communicate through a shared parent or a message broker**, never chains of delegates threaded across the tree.

# Tooling

- **Edit files with the Edit/Write tools, never shell heredocs.** No `python - <<PY`, `sed -i` or `awk` to rewrite source: the user reviews changes as diffs, and a heredoc hides the edit, skips the permission prompt and fails silently or confusingly (mangled escapes, quoting errors). Edit fails loudly on a mismatched anchor *before* writing. Use `replace_all` for repeated edits, Write for new files or full rewrites. Reading with `grep` / `sed -n` / `head` is fine; writing is not.
- **Never use PowerShell, and never use the PowerShell tool.** Bash for every shell command. Windows-only binaries (`tasklist`, `taskkill`, a project's `build.cmd`) run directly from Bash: no `cmd.exe /c` wrapper, ever. POSIX utilities otherwise. The only acceptable invocation is a `powershell` command the user types themselves and asks me to run as-is. Do not default to it even when the tool selector offers it.
- **Never `cd`: the working directory is already correct.** VS Code starts every terminal there, so a leading `cd` is noise at best and wrong at worst. Use paths relative to it, or absolute ones. The only valid `cd` is getting back after something earlier in the session deliberately moved it. Unsure where you are: run `pwd` once.
- **Never use Python where the project's own language belongs.** Python is not a general-purpose escape hatch. In a C++ project, logic and verification are C++ and builds are CMake or the project's build script; in a .NET project they are C#. Compute, check or prove with a real assertion in the project's test suite, not a throwaway script.
- **Use the C# MCP server (`mcp__csharp__*`) for ALL C# navigation and exploration**: definitions, references, call hierarchy, type hierarchy, outline, diagnostics. Not grep, not glob, not find.

# Tech stack & code preferences

- **Organize by domain (vertical slices), never by technical layer.** Endpoint, domain models, data access and integrations for one feature live in the same folder. No cross-cutting `Endpoints/`, `Services/`, `Persistence/` splitting one concept apart. Backend and frontend alike.
- **.NET data access: ADO.NET (Npgsql etc.), never EF Core or any ORM.** Map `DbDataReader` to POCO via extension methods. **Write side behind per-aggregate repositories**: they earn their keep because the same contract tests run against a fake for business logic and against the real database for integration. **Read side: thin raw parameterized SQL**, no repository ceremony. No generic `Repository<T>` or unit-of-work.
- **Web app frontend: native Web Components via `@relax.js/core`** as the only framework, plus MapLibre for maps. No React/Vue. **Semantic CSS with nested classes** (native CSS nesting), class names describing content/role rather than appearance; no utility or CSS frameworks (no Tailwind). **Load the `relaxjs` skill before writing frontend code** (installed per project via `npx @relax.js/core init-agents`); full docs in the docs MCP server (library: `relaxjs`).
