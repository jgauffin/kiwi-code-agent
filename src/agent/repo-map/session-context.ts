import { buildRepoMap, mapIsStale, readSummary } from './build-map'
import { MAP_ROOT } from './map-files'
import {
  CONTEXT_TIME_BOUND_MS,
  generatedContext,
  type ContextOptions,
  type GeneratedContext,
  type GeneratedSource,
} from '../session/generated-context'

/**
 * The repo map as a session start uses it: the reconcile run and the implement
 * session are given its summary, brought up to date first if it is behind.
 * Building and degrading are the shared rules in `session/generated-context`;
 * what lives here is what the repo map in particular is and says.
 */

/** How long a session start waits for a build before going ahead without it. */
export const REPO_MAP_TIME_BOUND_MS = CONTEXT_TIME_BOUND_MS

/** The map in the product's words; every note about it is written from this. */
const REPO_MAP = 'repo map'

/**
 * The modes that start with the map. Chat has no feature to place, and a plan
 * session is blind by design, so neither is given any of it.
 *
 * The mode is taken as a plain string: this module is host-side and mechanical,
 * and reaches for nothing in the session layer.
 */
export const wantsRepoMap = (mode: string): boolean => mode === 'reconcile' || mode === 'implement'

export type RepoMapSource = GeneratedSource
export type RepoMapContext = GeneratedContext
export type RepoMapOptions = ContextOptions

export const workspaceRepoMap = (cwd: string): RepoMapSource => ({
  isStale: () => mapIsStale(cwd),
  build: (onProgress) => buildRepoMap(cwd, onProgress),
  read: () => readSummary(cwd),
})

export const repoMapContext = (source: RepoMapSource, options: RepoMapOptions = {}): Promise<RepoMapContext> =>
  generatedContext(REPO_MAP, source, options)

/** The map as it goes into a system prompt: the note, the summary, and how to reach what the summary names. */
export function repoMapSection(context: RepoMapContext): string {
  const lines = ['## The repo map', '', context.note]
  if (context.summary) {
    lines.push(
      '',
      context.summary.trim(),
      '',
      `Open a project's type index by the path the list above names with Read; the map lives under \`${MAP_ROOT}/\` and search does not descend there.`,
      'The map is generated output: a write into it is lost at the next build, so record nothing there.',
    )
  }
  return lines.join('\n')
}

/**
 * The system prompt a session of this mode starts with. For a mode that does
 * not want the map the prompt is returned untouched and nothing is built.
 */
export async function withRepoMap(
  mode: string,
  systemPrompt: string,
  source: RepoMapSource,
  options: RepoMapOptions = {},
): Promise<string> {
  if (!wantsRepoMap(mode)) return systemPrompt
  const context = await repoMapContext(source, options)
  return `${systemPrompt}\n\n${repoMapSection(context)}`
}
