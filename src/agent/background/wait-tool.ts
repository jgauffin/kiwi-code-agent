import { connect } from 'node:net'
import { statSync } from 'node:fs'
import { resolve } from 'node:path'
import { z } from 'zod'
import { fail, ok, type Tool, type ToolContext, type ToolOutput } from '../openai-session/tools/tool'
import type { BackgroundCommands } from './background-commands'

export const BACKGROUND_WAIT_TOOL = 'BackgroundWait'

/** No wait runs longer than this, whatever the model asks for. */
export const MAX_WAIT_SECONDS = 600
const TAIL_LINES = 20

const schema = z.object({
  until: z
    .enum(['exit', 'output', 'url', 'port', 'file'])
    .describe(
      'exit: a background command exits. output: a background command prints a line matching a pattern. url: a URL answers with any HTTP response. port: a port accepts connections. file: a file exists, changes or is gone.',
    ),
  id: z.string().optional().describe('exit and output: the id the background command was started with'),
  pattern: z.string().optional().describe('output: a regular expression a line of output has to match'),
  url: z.string().optional().describe('url: the address to request'),
  host: z.string().optional().describe('port: the host, localhost when left out'),
  port: z.number().int().min(1).max(65535).optional().describe('port: the port number'),
  path: z.string().optional().describe('file: the file to watch'),
  change: z.enum(['exists', 'changes', 'gone']).optional().describe('file: exists (the default), changes from how it is now, or is gone'),
  timeoutSeconds: z.number().positive().optional().describe(`How long to wait at most, up to ${MAX_WAIT_SECONDS} seconds (the default)`),
})
type Input = z.infer<typeof schema>

/** The timings a wait runs on; a test shortens them. */
export type WaitClock = { pollMs: number; attemptMs: number }
const REAL_CLOCK: WaitClock = { pollMs: 250, attemptMs: 5000 }

/** The outcome of one check of a condition: it holds with a description, or it does not yet, with what was seen. */
type Check = { holds: string } | { seen: string }

const lastLines = (text: string): string => text.trimEnd().split(/\r?\n/).slice(-TAIL_LINES).join('\n')

const exitText = (code: number | null): string => (code === null ? 'it was stopped or could not be run' : `exit code ${code}`)

/**
 * Waits for one condition to hold and returns as soon as it does. Nothing here
 * stops a command it watches: an interrupted or timed out wait leaves it running.
 */
export function backgroundWaitTool(sessionId: string, commands: BackgroundCommands, clock: WaitClock = REAL_CLOCK): Tool<typeof schema> {
  return {
    name: BACKGROUND_WAIT_TOOL,
    description:
      'Waits until one condition holds, then returns: a background command exits, a background command prints a line matching a pattern, a URL answers with any HTTP response, a port accepts connections, or a file exists, changes or is gone. ' +
      `Returns at once when it already holds. Gives up after the timeout (at most ${MAX_WAIT_SECONDS} seconds) and says what it last saw. Use it instead of sleeping and looking again.`,
    schema,
    // It only looks; a wait on a URL, a port or a file is judged by what it reaches.
    readOnly: true,
    async execute(input, ctx) {
      const timeoutMs = Math.min(input.timeoutSeconds ?? MAX_WAIT_SECONDS, MAX_WAIT_SECONDS) * 1000
      if (input.until === 'exit' || input.until === 'output') return waitForCommand(input, sessionId, commands, ctx, timeoutMs, clock)
      return poll(await checkerFor(input, ctx, clock), ctx.signal, timeoutMs, clock.pollMs)
    },
  }
}

async function waitForCommand(input: Input, sessionId: string, commands: BackgroundCommands, ctx: ToolContext, timeoutMs: number, clock: WaitClock): Promise<ToolOutput> {
  if (!input.id) return fail('Name the background command with id.')
  const watched = commands.watch(sessionId, input.id)
  if (!watched) return fail(`No background command ${input.id} is running or waiting to be told of.`)
  const pattern = outputPattern(input)
  if (pattern.failure) return pattern.failure
  const { matches } = pattern
  const ended = (code: number | null, extra: string): ToolOutput => {
    commands.claimEnd(sessionId, input.id!)
    const tail = lastLines(watched.output())
    return ok(`Background command ${input.id} ended with ${exitText(code)}${extra}.\n${tail ? `Last lines of output:\n${tail}` : 'It printed nothing.'}`)
  }
  const missedPattern = matches ? ' without printing a line matching the pattern' : ''

  let exit: { code: number | null } | undefined
  void watched.exited.then((code) => (exit = { code }))
  const started = Date.now()
  for (;;) {
    const line = matchingLine(watched.output(), matches)
    if (line !== undefined) return ok(`Background command ${input.id} printed a matching line:\n${line}`)
    // The pattern may have been printed in the last moment before it exited; it was looked for above.
    if (exit) return ended(exit.code, missedPattern)
    if (ctx.signal.aborted) return fail(`The wait was interrupted. Background command ${input.id} is still running.`)
    if (Date.now() - started >= timeoutMs) return timedOut(input.id, watched.output(), timeoutMs)
    await Promise.race([sleep(clock.pollMs, ctx.signal), watched.exited])
  }
}

/** The pattern an output wait looks for; a failure when it is missing or not a regular expression. */
function outputPattern(input: Input): { matches?: RegExp; failure?: ToolOutput } {
  if (input.until !== 'output') return {}
  if (!input.pattern) return { failure: fail('Give the pattern a line of output has to match.') }
  try {
    return { matches: new RegExp(input.pattern) }
  } catch (error) {
    return { failure: fail(`The pattern is not a regular expression: ${(error as Error).message}`) }
  }
}

const matchingLine = (output: string, matches: RegExp | undefined): string | undefined =>
  matches ? output.split(/\r?\n/).find((line) => matches.test(line)) : undefined

function timedOut(id: string, output: string, timeoutMs: number): ToolOutput {
  const tail = lastLines(output)
  return ok(`Timed out after ${Math.round(timeoutMs / 1000)} seconds; background command ${id} is still running.\n${tail ? `Last lines of output:\n${tail}` : 'It has printed nothing.'}`)
}

async function checkerFor(input: Input, ctx: ToolContext, clock: WaitClock): Promise<() => Promise<Check> | Check> {
  if (input.until === 'url') return urlChecker(input.url, ctx, clock)
  if (input.until === 'port') return portChecker(input.host ?? 'localhost', input.port, clock)
  return fileChecker(input, ctx)
}

function urlChecker(url: string | undefined, ctx: ToolContext, clock: WaitClock): () => Promise<Check> | Check {
  if (!url) return failing('Give the url to request.')
  return async () => {
    try {
      const response = await fetch(url, { signal: AbortSignal.any([ctx.signal, AbortSignal.timeout(clock.attemptMs)]), redirect: 'manual' })
      void response.body?.cancel().catch(() => undefined)
      return { holds: `${url} answered with HTTP ${response.status}` }
    } catch (error) {
      return { seen: `${url} did not answer: ${(error as Error).message}` }
    }
  }
}

function portChecker(host: string, port: number | undefined, clock: WaitClock): () => Promise<Check> | Check {
  if (port === undefined) return failing('Give the port to connect to.')
  return () =>
    new Promise<Check>((done) => {
      const socket = connect({ host, port })
      socket.setTimeout(clock.attemptMs)
      socket.once('connect', () => (socket.destroy(), done({ holds: `${host}:${port} accepts connections` })))
      socket.once('timeout', () => (socket.destroy(), done({ seen: `${host}:${port} did not answer within ${clock.attemptMs} ms` })))
      socket.once('error', (error) => (socket.destroy(), done({ seen: `${host}:${port} refused: ${error.message}` })))
    })
}

function fileChecker(input: Input, ctx: ToolContext): () => Promise<Check> | Check {
  if (!input.path) return failing('Give the path of the file to watch.')
  const file = resolve(ctx.cwd, input.path)
  const stateOf = (): string | undefined => {
    try {
      const s = statSync(file)
      return `${s.mtimeMs}:${s.size}`
    } catch {
      return undefined
    }
  }
  const change = input.change ?? 'exists'
  const before = stateOf()
  return () => {
    const now = stateOf()
    if (change === 'exists') return now !== undefined ? { holds: `${input.path} exists` } : { seen: `${input.path} does not exist` }
    if (change === 'gone') return now === undefined ? { holds: `${input.path} is gone` } : { seen: `${input.path} still exists` }
    return now !== before ? { holds: `${input.path} ${now === undefined ? 'was removed' : before === undefined ? 'appeared' : 'changed'}` } : { seen: `${input.path} has not changed` }
  }
}

/** A checker that reports a mistake in the input instead of a condition. */
function failing(message: string): () => Check {
  return () => {
    throw new InputError(message)
  }
}

class InputError extends Error {}

async function poll(check: () => Promise<Check> | Check, signal: AbortSignal, timeoutMs: number, pollMs: number): Promise<ToolOutput> {
  const started = Date.now()
  let seen = ''
  for (;;) {
    let result: Check
    try {
      result = await check()
    } catch (error) {
      if (error instanceof InputError) return fail(error.message)
      throw error
    }
    if ('holds' in result) return ok(result.holds)
    seen = result.seen
    if (signal.aborted) return fail('The wait was interrupted.')
    if (Date.now() - started >= timeoutMs) return ok(`Timed out after ${Math.round(timeoutMs / 1000)} seconds. Last seen: ${seen}`)
    await sleep(pollMs, signal)
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((done) => {
    if (signal.aborted) return done()
    const timer = setTimeout(finish, ms)
    function finish() {
      clearTimeout(timer)
      signal.removeEventListener('abort', finish)
      done()
    }
    signal.addEventListener('abort', finish, { once: true })
  })
}
