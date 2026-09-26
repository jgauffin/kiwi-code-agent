import { ASK_USER_TOOL } from '../openai-session/tools/ask-user'
import { DOCS_DIR, PLAN_DIR, README_GLOB, SPECS_GLOB } from './blind-plan'
import type { Scope } from './scope-guard'

/**
 * The docs judged as a planner's way in. A blind planner has the docs and
 * nothing else, so how they are arranged decides how much it has to read and
 * whether it can cite what it found. This session says where the arrangement
 * defeats that, and changes it when the user says so.
 *
 * It reads what the planner reads and no more. The mapper's files are denied:
 * a run that read the code wrote them, and a suggestion drawn from those would
 * put the code's shape back into the one input that is meant to be free of it.
 */

/** `ignored` comes from the `kiwiAgent.planIgnore` setting: docs the planner must not see are not the evaluation's to judge. */
export function docsEvaluationScope(ignored: string[] = []): Scope {
  return {
    readable: [`${DOCS_DIR}/**`, README_GLOB, SPECS_GLOB],
    // Nothing is the evaluation's deliverable: the findings are said in chat.
    writable: [],
    // The docs are the user's. Each change is one confirmed write, asked for by them.
    askable: [`${DOCS_DIR}/**`],
    ignored,
  }
}

/**
 * Write and Edit are here for the changes the user asks for, not for the
 * evaluation itself: the scope leaves both to the permission prompt.
 */
export const DOCS_EVALUATION_TOOLS = ['Read', 'Glob', 'Write', 'Edit', ASK_USER_TOOL]

/** The first message: there is nothing to configure, so the session starts on the job. */
export function docsEvaluationKickoff(): string {
  return 'Go through the docs and say where their arrangement would cost a planner. Change nothing yet.'
}

/**
 * Docs evaluation system prompt. The job is discovery, not correctness: what a
 * planner cannot find, not what the docs get wrong.
 */
export function docsEvaluationPrompt(cwd: string): string {
  return `You are judging a software product's documentation as a planner's way into it, under ${cwd}.

Why this matters: a feature here is planned blind. The planner reads \`${DOCS_DIR}/**\`, the workspace README and the approved specs under \`${SPECS_GLOB}\`, never the source, and writes a spec of named rules, each rule citing the section it came from as \`path#Heading\`. So how the docs are arranged decides two things: how much the planner has to read before it finds an answer, and whether what it found can be cited at all.

You judge that arrangement. Not the prose, not whether the docs are right, not whether they are complete: they are meant to be to the point, not complete. Only what a planner cannot find, or finds in a place it cannot point at.

What you may read: \`${DOCS_DIR}/**\`, the README, and every spec under \`${SPECS_GLOB}\`. The docs map above already gives you every doc and every section, so read a doc only when the map does not tell you enough. Nothing else exists for you; do not try.

What counts as a finding:
- a doc long enough that answering one question means reading all of it, where the sections would stand on their own
- a heading that does not say what is under it, so neither the map's line nor a citation to it helps
- one subject spread over several docs with nothing linking them, so finding one part does not lead to the rest
- a folder with no way in: no index, so the only way to know what is there is to open every file
- a term the docs lean on but define nowhere, or define in passing under a heading about something else, so no rule can cite its definition
- a passage a rule would want to cite that sits under no heading of its own

**A heading an approved spec already cites is load-bearing.** Renaming or moving it breaks that citation, and nothing in this product would report it: no build, no test, no view. Before you propose a change to a heading, look for it in the specs. If a spec cites it, say so on the same line and name every citation that would have to follow, so the user is choosing with that in front of them.

Say it in chat, one line per finding: the section as \`path#Heading\` (or the doc, when it is the whole file), what it costs a planner today, and the change in one sentence. Strongest first: what saves the most reading, or fixes the most citations. A finding earns its place only if a planner is measurably better off. If the docs already navigate well, say that in one line and stop; an empty list is a good result, not a failure.

Write nothing. The user picks what to change and tells you; only then do you edit, only what was picked, and each write is confirmed by them. Keep every heading an approved spec cites unless the user has said to change it knowing what it costs. When a doc is split, the parts keep the headings they had, so the citations still land.

If a finding needs something only the user can settle, ask with \`${ASK_USER_TOOL}\` rather than guessing. Nothing under \`${PLAN_DIR}/\` is yours to write.`
}
