import { buildRepoMap, mapIsStale, readSummary } from './build-map'
import { MAP_ROOT } from './map-files'

/**
 * What a session start does about the map: the reconcile run and the implement
 * session are given its summary, the map is brought up to date first if it is
 * behind, and a build that cannot deliver never holds the start hostage — the
 * session begins on the map as it last stood, or on none, and is told which.
 *
 * The result is a string handed to the engine at its creation, so the map a
 * session works from is fixed for the life of that engine: another build
 * rewriting the files underneath changes nothing it holds.
 */

/** How long a session start waits for a build before going ahead without it. */
export const REPO_MAP_TIME_BOUND_MS = 60_000

/**
 * The modes that start with the map. Chat has no feature to place, and a plan
 * session is blind by design, so neither is given any of it.
 *
 * The mode is taken as a plain string: this module is host-side and mechanical,
 * and reaches for nothing in the session layer.
 */
export const wantsRepoMap = (mode: string): boolean => mode === 'reconcile' || mode === 'implement'

/** The map as a session start uses it; the workspace is one implementation, a test another. */
export type RepoMapSource = {
  isStale(): Promise<boolean>
  build(onProgress: (line: string) => void): Promise<unknown>
  read(): Promise<string | undefined>
}

export const workspaceRepoMap = (cwd: string): RepoMapSource => ({
  isStale: () => mapIsStale(cwd),
  build: (onProgress) => buildRepoMap(cwd, onProgress),
  read: () => readSummary(cwd),
})

/** The summary the session starts with, and the one line saying where it came from. */
export type RepoMapContext = {
  summary?: string
  note: string
}

export type RepoMapOptions = {
  onProgress?: (line: string) => void
  timeoutMs?: number
}

const REBUILT = "The repo map was rebuilt at this session's start."
const CURRENT = "The repo map was current at this session's start."

/**
 * Brings the map up to date if it is behind and reads the summary. A failed or
 * overlong build is not an error here: it becomes the note the session reads.
 */
export async function repoMapContext(source: RepoMapSource, options: RepoMapOptions = {}): Promise<RepoMapContext> {
  const onProgress = options.onProgress ?? (() => {})
  const timeoutMs = options.timeoutMs ?? REPO_MAP_TIME_BOUND_MS
  let built = false
  let failure: string | undefined
  // Not stale is the common case: nothing is built and nothing is waited on.
  const stale = await source.isStale().catch((error: unknown) => {
    failure = reason(error)
    return false
  })
  if (stale) {
    onProgress('Building the repo map…')
    failure = await withinBound(() => source.build(onProgress), timeoutMs)
    built = failure === undefined
  }
  const summary = await source.read().catch(() => undefined)
  return { ...(summary ? { summary } : {}), note: noteFor(summary, failure, built) }
}

function noteFor(summary: string | undefined, failure: string | undefined, built: boolean): string {
  if (failure === undefined) return summary ? (built ? REBUILT : CURRENT) : 'No repo map is available for this workspace.'
  if (summary) return `The repo map could not be rebuilt (${failure}); this is the map as it last stood, so it may be behind the source.`
  return `No repo map is available: it could not be built (${failure}).`
}

const reason = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/** The reason a call failed, or undefined when it did not; a thrown value never reaches the caller. */
async function attempt(run: () => Promise<unknown>): Promise<string | undefined> {
  try {
    await run()
    return undefined
  } catch (error) {
    return reason(error)
  }
}

/**
 * The build's time bound. A build that passes it is left running — it is shared,
 * so the next start joins it rather than beginning again — and the session
 * starts on what is already on disk.
 */
async function withinBound(run: () => Promise<unknown>, timeoutMs: number): Promise<string | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const bound = new Promise<string>((resolve) => {
    timer = setTimeout(() => resolve('the build passed its time bound'), timeoutMs)
  })
  try {
    return await Promise.race([attempt(run), bound])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

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
