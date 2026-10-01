import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { KIWI_DIR } from './kiwi-dir'
import { parseGitignore } from './repo-map/workspace-scan'

/**
 * Makes sure a repository ignores the agent's folder: run logs, maps and the
 * scratch folders are the agent's own and never belong in a commit. A folder
 * that is not a repository is left without a `.gitignore`.
 */
export async function ensureAgentDirIgnored(cwd: string): Promise<'added' | 'present' | 'no-repo'> {
  // A worktree or submodule has a `.git` file instead of a folder; either marks a repository.
  if (!existsSync(join(cwd, '.git'))) return 'no-repo'
  const path = join(cwd, '.gitignore')
  const text = existsSync(path) ? await readFile(path, 'utf8') : ''
  if (parseGitignore(text)(KIWI_DIR, true)) return 'present'
  const separator = text === '' || text.endsWith('\n') ? '' : '\n'
  await writeFile(path, `${text}${separator}${KIWI_DIR}/\n`, 'utf8')
  return 'added'
}
