import variant from '@jitl/quickjs-singlefile-cjs-release-sync'
import { newQuickJSWASMModule, type QuickJSContext, type QuickJSDeferredPromise, type QuickJSHandle, type QuickJSWASMModule } from 'quickjs-emscripten'
import { errorMessage } from '../../error-message'

// The single-file build carries its WASM inside the JavaScript, so the bundle needs no asset next to it.
let engine: Promise<QuickJSWASMModule> | undefined
const getQuickJS = () => (engine ??= newQuickJSWASMModule(variant))

/** What the script may call: a name and JSON-shaped arguments in, a JSON-shaped result out. */
export type HostCall = (name: string, args: unknown) => Promise<unknown>

export type SandboxOptions = {
  signal: AbortSignal
  /** Time the script itself may spend running; time waiting on host calls (a permission prompt) is not counted. */
  cpuBudgetMs: number
  memoryLimitBytes: number
  /** Guest-side source run before the script, for helpers built from the functions the host offers. */
  prelude?: string
}

export type SandboxResult = { ok: true; value: unknown } | { ok: false; error: string }

export const DEFAULT_SANDBOX_OPTIONS = { cpuBudgetMs: 10_000, memoryLimitBytes: 64 * 1024 * 1024 } as const

/**
 * Every capability reaches the script as `__call`, one function taking the
 * name and the JSON of the arguments. The named functions are built in the
 * guest from the names the host offers, so the host never handles guest
 * objects beyond strings.
 */
const prelude = (names: string[]) => `
${names.map((n) => `globalThis[${JSON.stringify(n)}] = async (...args) => JSON.parse(await __call(${JSON.stringify(n)}, JSON.stringify(args)) ?? 'null');`).join('\n')}
globalThis.console = { log: (...a) => __log(a.map((x) => typeof x === 'string' ? x : JSON.stringify(x)).join(' ')) };
`

/**
 * Runs a script in a fresh QuickJS realm. The realm has no file, network or
 * process access of its own; the only way out is `host`. The script body is an
 * async function body, so `await` and `return` work at its top level.
 */
export async function runSandboxed(
  source: string,
  hostNames: string[],
  host: HostCall,
  options: SandboxOptions,
  onLog: (line: string) => void = () => {},
): Promise<SandboxResult> {
  const quickjs = await getQuickJS()
  const runtime = quickjs.newRuntime()
  runtime.setMemoryLimit(options.memoryLimitBytes)
  const context = runtime.newContext()

  let spent = 0
  let sliceStart = 0
  let timedOut = false
  runtime.setInterruptHandler(() => {
    if (options.signal.aborted) return true
    if (spent + (Date.now() - sliceStart) > options.cpuBudgetMs) {
      timedOut = true
      return true
    }
    return false
  })
  const slice = <T>(run: () => T): T => {
    sliceStart = Date.now()
    try {
      return run()
    } finally {
      spent += Date.now() - sliceStart
    }
  }
  const pump = () => slice(() => runtime.executePendingJobs())

  const settle = (deferred: QuickJSDeferredPromise, make: () => QuickJSHandle, how: 'resolve' | 'reject') => {
    if (!context.alive || !deferred.alive) return
    const value = make()
    deferred[how](value)
    value.dispose()
    deferred.dispose()
  }
  const open = new Set<QuickJSDeferredPromise>()
  const inFlight = new Set<Promise<void>>()
  const call = context.newFunction('__call', (nameHandle: QuickJSHandle, argsHandle: QuickJSHandle) => {
    const name = context.getString(nameHandle)
    const args = JSON.parse(context.getString(argsHandle)) as unknown
    const deferred = context.newPromise()
    open.add(deferred)
    const work = host(name, args).then(
      (value) => settle(deferred, () => context.newString(JSON.stringify(value === undefined ? null : value)), 'resolve'),
      (error: unknown) => settle(deferred, () => context.newError(errorMessage(error)), 'reject'),
    )
    const tracked = work.then(() => {
      inFlight.delete(tracked)
      if (context.alive) pump()
    })
    inFlight.add(tracked)
    return deferred.handle
  })
  context.setProp(context.global, '__call', call)
  call.dispose()
  const log = context.newFunction('__log', (lineHandle: QuickJSHandle) => {
    onLog(context.getString(lineHandle))
  })
  context.setProp(context.global, '__log', log)
  log.dispose()

  try {
    const wrapped = `${prelude(hostNames)}\n${options.prelude ?? ''}\n(async () => {\n${source}\n})()`
    const evaluated = slice(() => context.evalCode(wrapped, 'script.js'))
    if (evaluated.error) return { ok: false, error: describe(context, evaluated.error, timedOut, options.signal) }
    const promise = evaluated.value
    const settled = context.resolvePromise(promise)
    promise.dispose()
    pump()
    const aborted = new Promise<'aborted'>((resolve) => options.signal.addEventListener('abort', () => resolve('aborted'), { once: true }))
    const result = await Promise.race([settled, aborted])
    if (result === 'aborted') return { ok: false, error: 'Interrupted' }
    if (result.error) return { ok: false, error: describe(context, result.error, timedOut, options.signal) }
    const value = context.dump(result.value)
    result.value.dispose()
    return { ok: true, value }
  } finally {
    // An interrupted script does not wait on calls the host may never answer; their late answers find the context gone.
    if (!options.signal.aborted) await Promise.allSettled([...inFlight])
    for (const deferred of open) if (deferred.alive) deferred.dispose()
    context.dispose()
    runtime.dispose()
  }
}

function describe(context: QuickJSContext, handle: QuickJSHandle, timedOut: boolean, signal: AbortSignal): string {
  const dumped = context.dump(handle) as { name?: string; message?: string } | string
  handle.dispose()
  if (signal.aborted) return 'Interrupted'
  if (timedOut) return 'Script exceeded its time budget'
  return typeof dumped === 'string' ? dumped : `${dumped.name ?? 'Error'}: ${dumped.message ?? ''}`
}
