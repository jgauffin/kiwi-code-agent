import { splitShellCommand } from '../../agent/permissions/shell-split'

/** A shell call's description and its commands, one per line; nothing when the input holds no command. */
export function shellCall(input: unknown): { description?: string; lines: string[] } | undefined {
  const record = (input ?? {}) as Record<string, unknown>
  if (typeof record['command'] !== 'string') return undefined
  const description = typeof record['description'] === 'string' && record['description'].trim() ? record['description'] : undefined
  const lines = splitShellCommand(record['command']).segments.map((s) => s.text)
  return { ...(description ? { description } : {}), lines: lines.length ? lines : [record['command']] }
}

/**
 * The agent a subagent call spawns: the name it is addressable under, else
 * the type it was asked for. Our own delegating tool names it with `agent`,
 * or inside `define` for a one-off sub agent.
 */
export function subagentName(input: unknown): string | undefined {
  if (typeof input !== 'object' || input === null) return undefined
  const record = input as Record<string, unknown>
  const define = typeof record['define'] === 'object' && record['define'] !== null ? (record['define'] as Record<string, unknown>) : undefined
  const named = [record['name'], record['subagent_type'], record['agent'], define?.['name']].find((value) => typeof value === 'string' && value.trim())
  return typeof named === 'string' ? named : undefined
}

export function summarizeInput(input: unknown): string {
  if (typeof input !== 'object' || input === null) return ''
  const record = input as Record<string, unknown>
  if (typeof record['source'] === 'string' && typeof record['destination'] === 'string') return `${record['source']} → ${record['destination']}`
  const key = ['command', 'file_path', 'pattern', 'path', 'query', 'description', 'task'].find((k) => typeof record[k] === 'string')
  if (!key) return ''
  const value = key === 'pattern' && typeof record['path'] === 'string' ? `${record[key]} in ${record['path']}` : (record[key] as string)
  return value.length > 80 ? value.slice(0, 77) + '...' : value
}

/** The lines a partial read covered, as `:first–last` (1-based offset); a whole-file read has none. */
export function lineRange(input: unknown): string {
  if (typeof input !== 'object' || input === null) return ''
  const record = input as Record<string, unknown>
  const offset = typeof record['offset'] === 'number' ? record['offset'] : undefined
  const limit = typeof record['limit'] === 'number' ? record['limit'] : undefined
  if (offset === undefined && limit === undefined) return ''
  const first = offset ?? 1
  return `:${first}–${limit === undefined ? '' : first + limit - 1}`
}
