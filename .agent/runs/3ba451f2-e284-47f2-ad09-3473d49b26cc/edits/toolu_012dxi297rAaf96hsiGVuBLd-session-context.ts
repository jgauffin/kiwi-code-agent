import { docsMapIsStale, readDocsSummary } from './build'
import { DOCS_MAP_ROOT } from './map-files'
import {
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

/** The map in the product's words; every note about it is written from this. */
const DOCS_MAP = 'docs map'

/**
 * The modes that start with the map: the blind planner, which has nothing but
 * the docs to work from, the docs evaluation, which judges how they are
 * arranged, and the filing of decisions, which finds the section each one
 * belongs in. The map is derived from the docs alone, so a blind session
 * reading it stays blind. A code plan gets it too: it settles intent before
 * it reads code, and the docs are where intent is written down.
 *
 * The mode is taken as a plain string: this module is host-side and mechanical,
 * and reaches for nothing in the session layer.
 */
export const wantsDocsMap = (mode: string): boolean =>
  mode === 'plan' || mode === 'code-plan' || mode === 'docs' || mode === 'file-decisions' || mode === 'doc-migration'

export type DocsMapSource = GeneratedSource
export type DocsMapContext = GeneratedContext

/**
 * `described`: a model turn writes one line per section, rebuilt when a doc
 * changes. `outline`: headings, line ranges and each doc's opening, read at
 * session start. Both exist so their effect on a planner can be compared.
 */
export type DocsMapStyle = 'described' | 'outline'

export type DocsMapOptions = ContextOptions & { style?: DocsMapStyle }

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

/** The map read from the docs themselves at session start: nothing to build, never behind. */
export const outlineDocsMap = (read: () => Promise<string | undefined>): DocsMapSource => ({
  isStale: async () => false,
  build: async () => undefined,
  read,
})

export const docsMapContext = (source: DocsMapSource, options: DocsMapOptions = {}): Promise<DocsMapContext> =>
  generatedContext(DOCS_MAP, source, options)

/** The map as it goes into a system prompt: the note, the map, and what it is for. */
export function docsMapSection(context: DocsMapContext, style: DocsMapStyle = 'described'): string {
  const lines = ['## The docs map', '', context.note]
  if (context.summary) {
    lines.push(
      '',
      style === 'described'
        ? 'Every doc you may read, what it is for, and one line per section. Nothing in it comes from anywhere but the docs themselves.'
        : 'Every doc you may read, its opening paragraph, and its sections with their line ranges, taken from the docs as they stand.',
      '',
      context.summary.trim(),
      '',
      'Use it to open the one doc that answers your question instead of reading the tree, and to cite a section as `path#Heading` with the heading spelled as the map spells it.',
      style === 'described'
        ? `The map is generated output under \`${DOCS_MAP_ROOT}/\`; it is not yours to read or write, and it says nothing the docs do not.`
        : 'A range is the lines of that section: Read just those with offset and limit.',
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
  return `${systemPrompt}\n\n${docsMapSection(context, options.style)}`
}
