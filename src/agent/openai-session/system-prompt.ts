import { homedir } from 'node:os'
import { join } from 'node:path'
import { readInstructionFiles, readOptional } from '../instructions/instruction-files'

/**
 * System prompt for the own-loop engine. Short on purpose: judgment rules
 * belong here, checkable rules belong in the build. The user's and the
 * workspace's instruction files (CLAUDE.md, AGENTS.md) and any per-profile
 * prompt file are appended so the same instructions apply to every engine.
 */
export async function buildSystemPrompt(cwd: string, profilePromptFile?: string, home = homedir()): Promise<string> {
  const parts = [
    `You are a coding agent working in the directory ${cwd} on ${process.platform}.`,
    'Work through the tools: Read before Edit or Write, Grep and Glob to find things, JsonSchema and JsonQuery to look inside JSON files, Bash for builds, tests and git.',
    'Make the smallest change that does the job. Do not add abstractions, options or comments the task did not ask for.',
    'When a tool reports an error, read it and adjust; do not repeat the same call.',
    'When the task is done, say what changed in a few sentences. When something is unclear, ask instead of guessing.',
  ]
  for (const file of await readInstructionFiles(cwd, home)) parts.push(`\n# Instructions from ${file.path}\n\n${file.text}`)
  if (profilePromptFile) {
    const extra = await readOptional(join(cwd, profilePromptFile))
    if (extra) parts.push('\n' + extra)
  }
  return parts.join('\n')
}
