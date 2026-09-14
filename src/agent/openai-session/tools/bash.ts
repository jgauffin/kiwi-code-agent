import { z } from 'zod'
import { findBash, runShell } from '../../shell/run-shell'
import { fail, ok, truncate, type Tool } from './tool'

const schema = z.object({
  command: z.string().describe('Shell command to run'),
  timeout_ms: z.number().int().min(1000).max(600_000).optional().describe('Timeout in milliseconds, default 120000'),
})

export function bashTool(bashPath: string = findBash()): Tool<typeof schema> {
  return {
    name: 'Bash',
    description:
      'Runs a shell command (bash, Git Bash on Windows) and returns stdout and stderr. Every command starts in the project root; a cd does not carry over to the next call, so never cd to the root. Use for builds, tests and git. Not for reading or searching files; use Read, Grep and Glob.',
    schema,
    readOnly: false,
    async execute(input, ctx) {
      const result = await runShell(input.command, {
        cwd: ctx.cwd,
        timeoutMs: input.timeout_ms ?? 120_000,
        signal: ctx.signal,
        bashPath,
      })
      const text = truncate(result.output.trimEnd())
      switch (result.ended) {
        case 'spawn_error':
          return fail(result.output)
        case 'interrupt':
          return fail(`${text}\n[interrupted]`.trim())
        case 'timeout':
          return fail(`${text}\n[timed out]`.trim())
        case 'exit':
          return result.exitCode === 0 ? ok(text || '(no output)') : fail(`${text}\n[exit code ${result.exitCode}]`.trim())
      }
    },
  }
}
