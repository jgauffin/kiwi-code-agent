import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'

/** Git for Windows ships bash; on other platforms the system one is used. */
export function findBash(): string {
  if (process.platform !== 'win32') return 'bash'
  const candidates = [
    'C:\\Program Files\\Git\\bin\\bash.exe',
    'C:\\Program Files\\Git\\usr\\bin\\bash.exe',
    'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
    `${process.env['LOCALAPPDATA'] ?? ''}\\Programs\\Git\\bin\\bash.exe`,
  ]
  return candidates.find((c) => existsSync(c)) ?? 'bash'
}

export type ShellResult = {
  output: string
  exitCode: number | null
  ended: 'exit' | 'timeout' | 'interrupt' | 'spawn_error'
}

export type ShellOptions = {
  cwd: string
  timeoutMs: number
  signal?: AbortSignal
  bashPath?: string
}

/** Runs a command under bash, capturing stdout and stderr interleaved. */
export function runShell(command: string, options: ShellOptions): Promise<ShellResult> {
  const bashPath = options.bashPath ?? findBash()
  return new Promise((resolvePromise) => {
    const child = spawn(bashPath, ['-lc', command], {
      cwd: options.cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      detached: process.platform !== 'win32',
    })
    let output = ''
    let ended: ShellResult['ended'] | undefined
    let settled = false
    const settle = (result: ShellResult) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', onAbort)
      resolvePromise(result)
    }
    const killTree = (why: 'timeout' | 'interrupt') => {
      ended = why
      killProcessTree(child)
    }
    const timer = setTimeout(() => killTree('timeout'), options.timeoutMs)
    const onAbort = () => killTree('interrupt')
    options.signal?.addEventListener('abort', onAbort)
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (d: string) => (output += d))
    child.stderr.on('data', (d: string) => (output += d))
    child.on('error', (error) => settle({ output: `Cannot run bash (${bashPath}): ${error.message}`, exitCode: null, ended: 'spawn_error' }))
    const finish = (code: number | null) => settle({ output, exitCode: code, ended: ended ?? 'exit' })
    // `close` waits for the pipes, which a surviving grandchild can hold
    // open; after a kill, `exit` is the signal to stop waiting.
    child.on('close', finish)
    child.on('exit', (code) => {
      if (ended) finish(code)
    })
  })
}

function killProcessTree(child: ChildProcess): void {
  if (child.pid === undefined) return
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }).on('error', () =>
      child.kill('SIGKILL'),
    )
  } else {
    try {
      process.kill(-child.pid, 'SIGKILL')
    } catch {
      child.kill('SIGKILL')
    }
  }
}
