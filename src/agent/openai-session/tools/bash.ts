import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { z } from 'zod'
import { fail, ok, truncate, type Tool, type ToolOutput } from './tool'

const schema = z.object({
  command: z.string().describe('Shell command to run'),
  timeout_ms: z.number().int().min(1000).max(600_000).optional().describe('Timeout in milliseconds, default 120000'),
})

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

export function bashTool(bashPath: string = findBash()): Tool<typeof schema> {
  return {
    name: 'Bash',
    description:
      'Runs a shell command in the working directory (bash, Git Bash on Windows) and returns stdout and stderr. Use for builds, tests and git. Not for reading or searching files; use Read, Grep and Glob.',
    schema,
    readOnly: false,
    execute(input, ctx) {
      return new Promise<ToolOutput>((resolvePromise) => {
        const child = spawn(bashPath, ['-lc', input.command], {
          cwd: ctx.cwd,
          env: process.env,
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
          detached: process.platform !== 'win32',
        })
        let output = ''
        let killedBecause: 'timeout' | 'interrupt' | undefined
        let settled = false
        const settle = (result: ToolOutput) => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          ctx.signal.removeEventListener('abort', onAbort)
          resolvePromise(result)
        }
        const killTree = (why: 'timeout' | 'interrupt') => {
          killedBecause = why
          killProcessTree(child)
        }
        const timer = setTimeout(() => killTree('timeout'), input.timeout_ms ?? 120_000)
        const onAbort = () => killTree('interrupt')
        ctx.signal.addEventListener('abort', onAbort)
        child.stdout.setEncoding('utf8')
        child.stderr.setEncoding('utf8')
        child.stdout.on('data', (d: string) => (output += d))
        child.stderr.on('data', (d: string) => (output += d))
        child.on('error', (error) => settle(fail(`Cannot run bash (${bashPath}): ${error.message}`)))
        const finish = (code: number | null) => {
          const text = truncate(output.trimEnd())
          if (killedBecause === 'interrupt') settle(fail(`${text}\n[interrupted]`.trim()))
          else if (killedBecause === 'timeout') settle(fail(`${text}\n[timed out]`.trim()))
          else if (code !== 0) settle(fail(`${text}\n[exit code ${code}]`.trim()))
          else settle(ok(text || '(no output)'))
        }
        // `close` waits for the pipes, which a surviving grandchild can hold
        // open; after a kill, `exit` is the signal to stop waiting.
        child.on('close', finish)
        child.on('exit', (code) => {
          if (killedBecause) finish(code)
        })
      })
    },
  }
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
