# Decisions for Cleanup phase

### F1 [applied]
- on: B5
- finding: B5 assumes branch points are "counted the same way in every language". There is no branch counting in the code at all, and no parser: `measureUnits` in src/agent/cleanup/unit-size.ts finds units by braces or indentation over literal-stripped text, and `languageOf` in src/agent/cleanup/language.ts knows a fixed extension table (JS/TS, C#, Java, Go, Rust, Kotlin, Swift, C/C++, PHP, Python — no Ruby, Scala, Perl…), with many units named `(anonymous)`. The spec should say complexity is counted from a fixed set of branching keywords and operators matched in the stripped source of a language the measure knows, each language's own keywords, and that a file in an unknown language has no function complexity (as E3). Amendment A2.
- proposed: Accept: B5 should say the branch points are the branching keywords and operators of the language the file is written in, drawn from the fixed set of languages the measure knows, found without parsing; "the same way in every language" promised a uniformity nothing can deliver. E3 then reads as the unknown-language case rather than only the unparseable one, and A2 records it.
- ruling: accepted

### F2 [applied]
- on: B5
- finding: the code measures a third unit kind, `type`, against `kiwiAgent.cleanup.typeLines` (default 200) — `UnitKind` in src/agent/cleanup/unit-size.ts, `limitFor`/`anyLimit` in src/agent/cleanup/oversized.ts, `cleanupThresholds` in src/extension.ts, the setting in package.json, the prompt's limit list in `cleanupPrompt`. The spec measures only functions and files, which retires that limit silently and leaves a shipped setting configured but dead.
- proposed: The spec stands: you ruled for complexity per function and lines per file, and a type's line count says little once its methods are held to a complexity limit. What the spec owes is to say the retirement out loud — the `typeLines` setting goes with the measure, and no unit of that kind is flagged — which I would add to B7 and record as an amendment; keeping a third limit is the other way, and yours to take.
- ruling: accepted

### F3 [applied]
- on: B11, E5
- finding: the spec assumes the second measure catches what the run left. `finishCleanup` in src/chat/chat-view-provider.ts measures only `child.files`, the paths flagged before the run, so a file the run created beside them — where `cleanupScope` in src/agent/phases/cleanup.ts tells it to put a split — is never measured and an oversized new file goes unreported; that second measure also passes an empty ignore list, so B4 does not hold on it. The spec should say the second measure covers the files the run wrote, the new ones included, under the same ignore globs. Amendment A3.
- proposed: Accept: B11 should say the second measure covers the flagged files together with the new files the run wrote beside them, under the same ignore globs as the first, since a split that only moves the excess into an oversized new file is exactly what E5 has to report. A3 records it.
- ruling: accepted

### F4 [applied]
- on: B12
- finding: `verify` in src/chat/chat-view-provider.ts hands a failing run to the implementer only while consecutive failures are within `kiwiAgent.verifyFailureBudget` (default 3), then leaves the failed record for the user; B12 says the run repeats until the board is green again. Whether the post-cleanup failure is exempt from the budget or counted in it is the ruling; the task is one line in `verify`.
- proposed: Rule for the code: a post-cleanup failure is an ordinary failure and counts against `kiwiAgent.verifyFailureBudget`, because a split the implementer cannot repair would otherwise loop without end and never reach the user. I would revise B12 to say it is handed over like any other failure, the budget included, and drop "until the board is green again".
- ruling: accepted
