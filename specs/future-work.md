# Future work

### A bundle may carry skills as well as rule text
- decided: A bundle declares whether it carries rule text, skills or both, and a bundle carrying skills travels the same sources, accepting, matching, versioning and required lists as a rule-text bundle; a bundled skill arrives with the files it refers to, is marked with its source, bundle and version, loses a name clash to a skill nobody's bundle installed, and nothing in a bundle runs when it is applied. Bundles still carry no commands, permission rules, settings or MCP servers.
- affects: organization bundles, agents md rule bundles, instructions and skills, docs/settings.md, docs/intent/agent.md

### A spec written from a doc about existing code can reach implemented without a build
- decided: When a feature is migrated out of the docs as behaviour the code already has and the check against the code reports no disagreement, the spec is marked implemented with no tasks and no test proofs, and its rules are not flagged for missing them; only the disagreements the check reports become build work.
- affects: doc migration, cleanup phase, docs/intent/agent.md
