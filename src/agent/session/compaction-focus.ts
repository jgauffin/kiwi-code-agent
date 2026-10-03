import type { SessionMode } from './session-manager'

/**
 * What a compaction has to carry over, per phase. A summary written for "a
 * coding session" keeps what was asked and done, and paraphrases away what a
 * phase cannot rebuild cheaply: a task run's rules word for word, a check's
 * findings not yet written down, a cleanup's units still over their limits.
 * Each engine adds `keep` to its own summary instruction, and the Claude
 * engine says `carryOn` when the turn goes on after its compaction.
 */
export type CompactionFocus = {
  /** What the summary must keep for this phase; empty where the general instruction says it all. */
  keep: string
  /** The message a turn carries on with once the engine has compacted it. */
  carryOn: string
}

const CARRY_ON = 'The conversation was compacted to make room. Carry on where you stopped; read again only the files you will change or check next, since the summary names the rest.'

const KEEP: Partial<Record<SessionMode | 'fix', string>> = {
  implement:
    'This is one task run of a feature. Keep, word for word, the task as first given with the text of the rules it delivers, the findings ruled to keep, and what earlier tasks built. Keep what this run has built so far by name and file, the test named for each rule with whether its last narrowed run passed, and any answer the user gave with where it was recorded.',
  fix: 'This run fixes a failed test run. Keep the key lines of the failing output as first given, each fix tried with how its narrowed run ended, and which tasks were moved and why.',
  reconcile:
    'This run checks an approved spec against the code. Keep which rules are checked and which remain, every disagreement found so far with the rules it concerns even if it is not yet written to the decisions file, and the files found for each scenario.',
  cleanup:
    'This run splits oversized units. Keep the units still over their limits, those done or left alone with the reason, each split made and where its pieces went, and the callers and tests found for what was moved.',
  plan: "This session plans a feature blind to the code. Keep the feature as the user first described it, word for word, the direction agreed and every answer the user gave. The spec and the plan files are on disk: say they are read again rather than carrying their text.",
  'code-plan':
    "This session plans a change against the code. Keep the developer's request word for word, the intent they confirmed, and the plan as last agreed, in full, with the rules it breaks and its two lists of decisions.",
  'doc-migration':
    'This session cleans up the docs in three stages. Keep which stage it is in, each finding or offer made with the user\'s answer to it, what was written, and what still waits on the user.',
  'file-decisions': 'This session files recorded decisions. Keep each entry with where it was proposed to go, what the user picked, and what has been filed.',
  'docs-map': 'This run writes docs map entries. Keep which docs have their entry written and which remain.',
}

const CARRY_ON_HINT: Partial<Record<SessionMode | 'fix', string>> = {
  implement: ' ReadTasks with your task\'s name shows where the board stands.',
  fix: ' ReadTasks shows where the board stands.',
  reconcile: ' What you have written to the decisions and context files is on disk.',
}

/** The focus for a session acting as `mode`; a fix run is an implement session with a focus of its own. */
export function compactionFocus(mode: SessionMode, fix = false): CompactionFocus {
  const phase = fix ? 'fix' : mode
  return { keep: KEEP[phase] ?? '', carryOn: CARRY_ON + (CARRY_ON_HINT[phase] ?? '') }
}

/** The general focus, for a session no phase shapes. */
export const NO_FOCUS: CompactionFocus = { keep: '', carryOn: CARRY_ON }
