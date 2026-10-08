import { existsSync } from 'node:fs'
import { homedir } from 'node:os'

/**
 * Where to look for the Claude Code on this machine, as values rather than
 * reads, so the search is testable without an install to find.
 */
export type ClaudeLookup = {
  /** `kiwiAgent.claudeCodePath` as set; blank or absent when the person named none. */
  configured?: string | undefined
  /** The host's PATH, directories joined the way the platform joins them. */
  path: string
  /** The person's home directory, where the native installer puts the binary. */
  home: string
  windows: boolean
  exists: (candidate: string) => boolean
}

/**
 * The Claude Code to run a `claude-installed` session on, or nothing when the
 * machine has none. A configured path decides on its own: where it names
 * nothing that exists, the answer is nothing rather than another install, so a
 * typo surfaces as the engine going missing instead of a session quietly
 * running on a Claude Code the person did not choose.
 *
 * On Windows only `claude.exe` counts. A `.cmd` shim would need a shell to
 * start, and the engine is spawned without one.
 */
export function findInstalledClaude(lookup: ClaudeLookup): string | undefined {
  const configured = lookup.configured?.trim()
  if (configured) return lookup.exists(configured) ? configured : undefined
  const name = lookup.windows ? 'claude.exe' : 'claude'
  const separator = lookup.windows ? '\\' : '/'
  const under = (...parts: string[]) => parts.join(separator)
  const onPath = lookup.path
    .split(lookup.windows ? ';' : ':')
    .map((dir) => dir.trim().replace(/[\\/]$/, ''))
    .filter((dir) => dir !== '')
    .map((dir) => under(dir, name))
    .find((candidate) => lookup.exists(candidate))
  if (onPath) return onPath
  // What the native installer writes, which a PATH the editor inherited before
  // the install would not yet name.
  const installed = under(lookup.home, '.local', 'bin', name)
  return lookup.exists(installed) ? installed : undefined
}

/** `findInstalledClaude` against this machine. */
export function installedClaude(configured?: string): string | undefined {
  return findInstalledClaude({
    configured,
    path: process.env.PATH ?? '',
    home: homedir(),
    windows: process.platform === 'win32',
    exists: existsSync,
  })
}
