import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { SPECS_DIR } from './blind-plan'

/** `kiwiAgent.specFolders`: `default` follows the workspace, `by-domain` and `flat` always resolve to themselves. */
export type SpecFoldersSetting = 'default' | 'by-domain' | 'flat'

/** What the setting resolves to once it is read against the workspace: whether a new spec's folder is proposed at all. */
export type SpecFoldersMode = 'by-domain' | 'flat'

const SPEC_SUFFIX = '.spec.md'

/**
 * The domain folders `specs/` already has, at any depth, each by its path
 * under `specs/` (`orders/returns`): read before a direction is given so the
 * session reuses one of them rather than coining a synonym for a domain
 * already named. A folder counts only once it holds a spec; an empty folder
 * left behind by a move does not pull the workspace into by-domain mode on its
 * own.
 */
export async function existingSpecFolders(cwd: string): Promise<string[]> {
  const folders: string[] = []
  async function walk(rel: string): Promise<void> {
    let entries
    try {
      entries = await readdir(join(cwd, SPECS_DIR, rel), { withFileTypes: true })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw error
    }
    if (rel && entries.some((e) => e.isFile() && e.name.endsWith(SPEC_SUFFIX))) folders.push(rel)
    for (const entry of entries) if (entry.isDirectory()) await walk(rel ? `${rel}/${entry.name}` : entry.name)
  }
  await walk('')
  return folders.sort()
}

/**
 * `default` follows the workspace: a workspace that already has a domain
 * folder gets a folder for every new spec from here on, and one whose specs
 * all sit at the root keeps getting specs at the root. `by-domain` and `flat`
 * always resolve to themselves, whatever the workspace already has.
 */
export async function resolveSpecFoldersMode(cwd: string, setting: SpecFoldersSetting): Promise<SpecFoldersMode> {
  if (setting !== 'default') return setting
  return (await existingSpecFolders(cwd)).length > 0 ? 'by-domain' : 'flat'
}
