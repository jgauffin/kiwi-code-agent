import { docsMapIsStale, readDocsSummary } from './build'
import { DOCS_MAP_ROOT } from './map-files'
import {
  CONTEXT_TIME_BOUND_MS,
  generatedContext,
  type ContextOptions,
  type GeneratedContext,
  type GeneratedSource,
} from '../session/generated-context'

/**
 * The docs map as a session start uses it. Building and degrading are the
 * shared rules in `session/generated-context`; what lives here is what the
 * docs map in particular is and says.
 */

/** How long a session start waits for a build before going ahead without it. */
export const DOCS_MAP_TIME_BOUND_MS = CONTEXT_TIME_BOUND_MS

/** The map in the product's words; every note about it is written from this. */
const DOCS_MAP = 'docs map'

/**
 * The modes that start with the map: the blind planner, which has nothing but
 * the docs to work from, and the docs evaluation, which judges how they are
 * arranged. The map is derived from the docs alone, so a blind session reading
 * it stays blind.
 *
 * The mode is taken as a plain string: this module is host-side and mechanical,
 * and reaches for nothing in the session layer.
 */
export const wantsDocsMap = (mode: string): boolean => mode === 'plan' || mode === 'docs'

export type DocsMapSource = GeneratedSource
export type DocsMapContext = GeneratedContext
export type DocsMapOptions = ContextOptions

/**
 * The workspace's map. Describing a doc is a model turn, so the build is the
 * caller's to supply; reading and staleness are files on disk.
 */
export const workspaceDocsMap = (
  cwd: string,
  ignored: string[],
  build: (onProgress: (line: string) => void) => Promise<unknown>,
): DocsMapSource => ({
  isStale: () => docsMapIsStale(cwd, ignored),
  build,
  read: () => readDocsSummary(cwd),
})

export const docsMapContext = (source: DocsMapSource, options: DocsMapOptions = {}): Promise<DocsMapContext> =>
  generatedContext(DOCS_MAP, source, options)

/** The map as it goes into a system prompt: the note, the map, and what it is for. */
export function docsMapSection(context: DocsMapContext): string {
  const lines = ['## The docs map', '', context.note]
  if (context.summary) {
    lines.push(
      '',
      'Every doc you may read, what it is for, and one line per section. Nothing in it comes from anywhere but the docs themselves.',
      '',
      context.summary.trim(),
      '',
      'Use it to open the one doc that answers your question instead of reading the tree, and to cite a section as `path#Heading` with the heading spelled as the map spells it.',
      `The map is generated output under \`${DOCS_MAP_ROOT}/\`; it is not yours to read or write, and it says nothing the docs do not.`,
    )
  }
  return lines.join('\n')
}

/**
 * The system prompt a session of this mode starts with. For a mode that does
 * not want the map the prompt is returned untouched and nothing is built.
 */
export async function withDocsMap(
  mode: string,
  systemPrompt: string,
  source: DocsMapSource,
  options: DocsMapOptions = {},
): Promise<string> {
  if (!wantsDocsMap(mode)) return systemPrompt
  const context = await docsMapContext(source, options)
  return `${systemPrompt}\n\n${docsMapSection(context)}`
}
