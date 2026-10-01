import { readFile, rename } from 'node:fs/promises'

/** The file's text, or nothing when there is no such file. Any other failure propagates. */
export async function readOptional(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

const BUSY = new Set(['EPERM', 'EBUSY', 'EACCES'])

/**
 * Puts a staged file in place in one step. Windows refuses the rename while a
 * reader holds the old file open, which is a moment, not a failure: the writer
 * waits it out rather than falling back to a partial in-place write.
 */
export async function replaceFile(from: string, to: string, attempts = 500): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await rename(from, to)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? ''
      if (attempt >= attempts || !BUSY.has(code)) throw error
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
  }
}
