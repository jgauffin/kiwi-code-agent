import { fileEffect, writeOrDestroy, type CommandSite } from './classifiers/classifier'
import { effects, type Effect, type Invocation, type Ruling } from './effects'
import { expandBraces } from './places'
import { DELEGATE_TOOL } from '../openai-session/tools/delegate'
import { isResearchDelegation } from '../sub-agents/sub-agent-index'
import { isSubagentTool } from './tool-classes'

/** What the tool classifiers are told besides the call itself. */
export type ToolFacts = {
  /** Does this tool only look? A tool the session serves answers for itself; anything unknown does not. */
  readOnly(toolName: string): boolean
}

/** Tools that read the one file they name. */
const READS_FILE = new Set(['Read', 'NotebookRead'])
/** Tools that edit or write the one file they name, the change shown as a diff. */
const WRITES_FILE: Record<string, string> = { Write: 'file_path', Edit: 'file_path', MultiEdit: 'file_path', NotebookEdit: 'notebook_path' }
/** Tools that search or list below the path they are given, or where the session stands without one. */
const SEARCHES = new Set(['Grep', 'CodeSearch', 'MarkdownSearch', 'CodeOutline', 'JsonSchema', 'JsonQuery', 'SpecSearch'])
const LISTS = new Set(['LS', 'ReadDir'])
/** Tools that reach the open internet. */
const NETWORK = new Set(['WebFetch', 'WebSearch'])

/**
 * A tool call as the effects it would have. One answer per place for every
 * tool: reading a folder with Read and with `cat` is the same effect, covered
 * by the same kept answer.
 */
export function toolEffects(toolName: string, input: unknown, site: CommandSite, facts: ToolFacts): { invocation: Invocation; ruling: Ruling } {
  const invocation: Invocation = { command: [toolName], flags: new Set(), operands: [] }
  const named = (input ?? {}) as Record<string, unknown>
  const text = (key: string): string | undefined => (typeof named[key] === 'string' ? (named[key] as string) : undefined)
  const ruling = ((): Ruling => {
    if (READS_FILE.has(toolName)) return pathEffect('read', site, text('file_path') ?? text('notebook_path'), 'file')
    const writes = WRITES_FILE[toolName]
    if (writes !== undefined) return pathEffect('write', site, text(writes), 'file')
    if (toolName === 'Glob') return glob(site, text('path'), text('pattern'))
    if (toolName === 'Grep') return narrowed(site, text('path'), text('glob')) ?? searched(site, text('path'))
    if (SEARCHES.has(toolName)) return searched(site, text('path') ?? text('file_path'))
    // Whether a path is there is one entry of its folder: read wherever that path may be read, file or folder alike.
    if (toolName === 'Exists') return pathEffect('read', site, text('path') ?? text('file_path'), 'file')
    if (LISTS.has(toolName)) return pathEffect('read', site, text('path') ?? '.', 'directory')
    if (toolName === 'Move' || toolName === 'Copy') return transfer(toolName, site, text('source'), text('destination'))
    if (toolName === 'RunScript') {
      const files = Array.isArray(named['files']) ? named['files'].filter((f): f is string => typeof f === 'string') : []
      return effects(...files.map((f) => fileEffect('write', site, f, 'file')))
    }
    if (toolName === DELEGATE_TOOL) return isResearchDelegation(input) ? effects({ action: 'reaches', what: 'network', place: site.cwd }) : effects()
    // Starting a subagent does nothing itself: every call it makes is judged on its own, as the session's are.
    if (isSubagentTool(toolName)) return effects()
    if (NETWORK.has(toolName)) return effects({ action: 'reaches', what: 'network', place: site.cwd })
    if (facts.readOnly(toolName)) return effects()
    return effects({ action: 'reaches', what: 'command', place: site.cwd })
  })()
  const research = toolName === DELEGATE_TOOL && isResearchDelegation(input)
  return { invocation: research ? { ...invocation, command: [toolName, 'research'] } : invocation, ruling }
}

/** A tool that names no path where it needs one is presumed to touch the place it stands in. */
function pathEffect(action: 'read' | 'write', site: CommandSite, path: string | undefined, extent: 'file' | 'directory'): Ruling {
  return effects(path === undefined ? { action, place: site.cwd, extent: 'tree' } : fileEffect(action, site, path, extent))
}

/** A path that is a file is read alone; a directory, or none, is searched down its tree. */
function searched(site: CommandSite, path: string | undefined): Ruling {
  if (path === undefined) return effects({ action: 'read', place: site.cwd, extent: 'tree' })
  const effect = fileEffect('read', site, path, 'tree')
  if (effect.action === 'read' && 'path' in effect.place && effect.extent === 'tree' && site.exists(effect.place.path) === 'file') return effects({ ...effect, extent: 'file' })
  return effects(effect)
}

/**
 * A glob walks below its path by its pattern: what lies above the pattern's
 * first wildcard is where it reaches, for each of its brace alternatives.
 */
function glob(site: CommandSite, path: string | undefined, pattern: string | undefined): Ruling {
  const base = path ?? '.'
  if (pattern === undefined) return effects(fileEffect('read', site, base, 'tree'))
  const joined = (p: string) => (/^([\\/]|[A-Za-z]:)/.test(p) ? p : `${base.replace(/[\\/]+$/, '')}/${p}`)
  const alternatives = expandBraces(pattern) ?? [pattern]
  return effects(...alternatives.map((p) => fileEffect('read', site, joined(p), 'tree')))
}

/**
 * A search whose glob names folders below its path reads only there: with a
 * slash in it, a ripgrep glob is anchored at the path searched, so
 * `{a,b}/docs/**` reads `a/docs` and `b/docs`. A glob without a slash, a
 * negated one, or one too wide to expand narrows nothing.
 */
function narrowed(site: CommandSite, path: string | undefined, pattern: string | undefined): Ruling | undefined {
  if (pattern === undefined || pattern.startsWith('!')) return undefined
  const alternatives = expandBraces(pattern.replace(/^[\\/]+/, ''))
  // Every alternative must name a folder below the path; one that does not, or climbs out of it, leaves the search as wide as its path.
  if (alternatives === undefined || alternatives.some((p) => !/[\\/]/.test(p) || /^([A-Za-z]:|\.\.)/.test(p))) return undefined
  const base = (path ?? '.').replace(/[\\/]+$/, '')
  return effects(...alternatives.map((p) => fileEffect('read', site, `${base}/${p}`, 'tree')))
}

/** A move takes the source away and lands at the destination; a copy reads the source. */
function transfer(toolName: string, site: CommandSite, source: string | undefined, destination: string | undefined): Ruling {
  const list: Effect[] = []
  if (source !== undefined) list.push(fileEffect(toolName === 'Move' ? 'write' : 'read', site, source, 'tree'))
  if (destination !== undefined) list.push(writeOrDestroy(site, destination))
  return effects(...list)
}
