import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

/** Files by workspace-relative path, written under `dir`. */
export async function writeFiles(dir: string, files: Record<string, string>): Promise<void> {
  for (const [path, text] of Object.entries(files)) {
    const full = join(dir, ...path.split('/'))
    await mkdir(dirname(full), { recursive: true })
    await writeFile(full, text, 'utf8')
  }
}

/** A throwaway workspace holding `files`, removed once `fn` is done with it. */
export async function withWorkspace<T>(
  files: Record<string, string>,
  fn: (dir: string) => Promise<T>,
  prefix = 'workspace-',
): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  try {
    await writeFiles(dir, files)
    return await fn(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
