import { isAbsolute, relative, resolve } from 'node:path'

/**
 * Where a path lies in relation to the project root. Every permission decision
 * that turns on "is this ours?" asks here, so the answer is the same whether a
 * file tool, a shell command or a phase's scope is being judged.
 */
export type ProjectPaths = {
  /** The path read from the project root, with forward slashes, as rules and globs are written. */
  relative(path: string): string
  /** The root or anything below it. */
  inside(path: string): boolean
  /** Strictly below the root: the root itself is not a file to write, move or remove. */
  below(path: string): boolean
  /** Is the path that directory or below it? Both are read from the project root first. */
  under(directory: string, path: string): boolean
}

export function projectPaths(root: string): ProjectPaths {
  const from = (base: string, path: string) => relative(base, isAbsolute(path) ? path : resolve(root, path))
  // A path on another drive relativises to an absolute one, which is no more inside the project than `..` is.
  const contains = (rel: string) => !rel.startsWith('..') && !isAbsolute(rel)
  return {
    relative: (path) => from(root, path).split('\\').join('/'),
    inside: (path) => contains(from(root, path)),
    below: (path) => {
      const rel = from(root, path)
      return rel !== '' && contains(rel)
    },
    under: (directory, path) => contains(from(isAbsolute(directory) ? directory : resolve(root, directory), path)),
  }
}
