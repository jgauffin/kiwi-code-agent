import { homedir } from 'node:os'
import { join } from 'node:path'
import { instructionsText, readInstructionFiles } from '../instructions/instruction-files'
import { readOptional } from '../workspace-files'
import { DOC_READING } from './tools/markdown/outline-gate'
import { CODE_READING } from '../code-outline/code-outline-gate'
import { CHAT_DECISIONS } from '../phases/unfiled-decisions'
import { SPEC_AMENDING, SPEC_READING } from '../phases/blind-plan'
import { SCRIPT_WRITING } from '../script/script-gate'
import { EDIT_WRITING } from './tools/edit'
import { memoryWritingInstructions } from '../memory/memories'
import { memorySection, readMemorySources } from '../memory/session-context'
import { projectScriptsInstruction } from '../permissions/package-scripts'

/**
 * System prompt for the own-loop engine. Short on purpose: judgment rules
 * belong here, checkable rules belong in the build. The core lines stand in
 * for what Claude Code's preset says on the other engine; the fragments after
 * them are the text both engines share. The user's and the
 * workspace's instruction files (CLAUDE.md, AGENTS.md) and any per-profile
 * prompt file are appended so the same instructions apply to every engine.
 * The person's own memories ride along inside their CLAUDE.md, read below as
 * one of those files; only the project's, kept outside it, are added by name.
 */
export async function buildSystemPrompt(cwd: string, profilePromptFile?: string, home = homedir()): Promise<string> {
  const parts = [
    'You are a coding agent.',
    // No read-before-edit line: Edit, MultiEdit and Write refuse an unread or changed file and say to Read it.
    DOC_READING,
    CODE_READING,
    SCRIPT_WRITING,
    EDIT_WRITING,
    projectScriptsInstruction(cwd),
    'Make the smallest change that does the job. Do not add abstractions, options or comments the task did not ask for.',
    'When a tool reports an error, read it and adjust; do not repeat the same call.',
    'When the task is done, say what changed in a few sentences. When something is unclear, ask instead of guessing.',
    SPEC_READING,
    SPEC_AMENDING,
    CHAT_DECISIONS,
    memoryWritingInstructions(cwd, home),
    memorySection(await readMemorySources(cwd, home)) ?? '',
  ]
  const instructionFiles = await readInstructionFiles(cwd, home)
  if (instructionFiles.length > 0) parts.push(instructionsText(instructionFiles))
  if (profilePromptFile) {
    const extra = await readOptional(join(cwd, profilePromptFile))
    if (extra) parts.push('\n' + extra)
  }
  return parts.filter((part) => part !== '').join('\n')
}
