/**
 * What a session start does about a generated context: the repo map for a run
 * that works in the code, the docs map for one that works in the intent. The
 * context is brought up to date if it is behind, and a build that cannot
 * deliver never holds the start hostage: the session begins on the context as
 * it last stood, or on none, and is told which.
 *
 * The result is a string handed to the engine at its creation, so what a
 * session works from is fixed for the life of that engine: another build
 * rewriting the files underneath changes nothing it holds.
 */

/** How long a session start waits for a build before going ahead without it. */
export const CONTEXT_TIME_BOUND_MS = 60_000

/** A generated context as a session start uses it; the workspace is one implementation, a test another. */
export type GeneratedSource = {
  isStale(): Promise<boolean>
  build(onProgress: (line: string) => void): Promise<unknown>
  read(): Promise<string | undefined>
}

/** The summary the session starts with, and the one line saying where it came from. */
export type GeneratedContext = {
  summary?: string
  note: string
}

export type ContextOptions = {
  onProgress?: (line: string) => void
  timeoutMs?: number
}

/**
 * Brings the context up to date if it is behind and reads its summary. A failed
 * or overlong build is not an error here: it becomes the note the session reads.
 *
 * `name` is the context in the product's words ("repo map", "docs map"); every
 * note is written from it, so the two read alike wherever they surface.
 */
export async function generatedContext(name: string, source: GeneratedSource, options: ContextOptions = {}): Promise<GeneratedContext> {
  const onProgress = options.onProgress ?? (() => {})
  const timeoutMs = options.timeoutMs ?? CONTEXT_TIME_BOUND_MS
  let built = false
  let failure: string | undefined
  // Not stale is the common case: nothing is built and nothing is waited on.
  const stale = await source.isStale().catch((error: unknown) => {
    failure = reason(error)
    return false
  })
  if (stale) {
    onProgress(`Building the ${name}…`)
    failure = await withinBound(() => source.build(onProgress), timeoutMs)
    built = failure === undefined
  }
  const summary = await source.read().catch(() => undefined)
  return { ...(summary ? { summary } : {}), note: noteFor(name, summary, failure, built) }
}

function noteFor(name: string, summary: string | undefined, failure: string | undefined, built: boolean): string {
  if (failure === undefined) {
    if (!summary) return `No ${name} is available for this workspace.`
    return built ? `The ${name} was rebuilt at this session's start.` : `The ${name} was current at this session's start.`
  }
  if (summary) return `The ${name} could not be rebuilt (${failure}); this is the ${name} as it last stood, so it may be behind.`
  return `No ${name} is available: it could not be built (${failure}).`
}

const inFlight = new Map<string, Promise<unknown>>()

/**
 * One build per key at a time. A second caller asking while a build runs (a
 * session start, or the command during one) waits on that build and takes its
 * result rather than starting a second. The key names the workspace and the
 * kind of map, so the two maps of one workspace never wait on each other.
 */
export function sharedBuild<T>(key: string, run: () => Promise<T>): Promise<T> {
  const running = inFlight.get(key)
  if (running !== undefined) return running as Promise<T>
  const started = run().finally(() => {
    if (inFlight.get(key) === started) inFlight.delete(key)
  })
  inFlight.set(key, started)
  return started
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
 * The build's time bound. A build that passes it is left running, shared, so
 * the next start joins it rather than beginning again, and the session starts
 * on what is already on disk.
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
