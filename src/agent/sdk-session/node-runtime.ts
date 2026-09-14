import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import type { SpawnOptions, SpawnedProcess } from '@anthropic-ai/claude-agent-sdk'

/**
 * How to run a JavaScript file. The SDK asks for `node`; inside the VS Code
 * extension host there may be no `node` on PATH, but the host's own
 * executable runs as Node when told to.
 */
export type NodeRuntime = {
  command: string
  args: string[]
  env: Record<string, string>
}

export function nodeOnPath(): NodeRuntime {
  return { command: 'node', args: [], env: {} }
}

export function hostExecutableAsNode(execPath: string): NodeRuntime {
  return { command: execPath, args: [], env: { ELECTRON_RUN_AS_NODE: '1' } }
}

/**
 * Spawn function for `Options.spawnClaudeCodeProcess`. The SDK passes the
 * cli path as the first argument; only the runtime is swapped.
 *
 * The SDK reports every ENOENT as "executable not found at <cli path>", so
 * the things that can actually be missing are checked here first and named.
 */
export function spawnWithRuntime(runtime: NodeRuntime, onStderr: (line: string) => void) {
  return (options: SpawnOptions): SpawnedProcess => {
    const cliPath = options.args[0]
    if (cliPath && !existsSync(cliPath)) throw new Error(`Engine script missing: ${cliPath}`)
    if (options.cwd && !existsSync(options.cwd)) throw new Error(`Working directory missing: ${options.cwd}`)
    if (runtime.command.includes('/') || runtime.command.includes('\\')) {
      if (!existsSync(runtime.command)) throw new Error(`Node runtime missing: ${runtime.command}`)
    }
    onStderr(`[spawn] ${runtime.command} ${[...runtime.args, ...options.args].join(' ')} (cwd ${options.cwd})\n`)
    const child = spawn(runtime.command, [...runtime.args, ...options.args], {
      cwd: options.cwd,
      env: { ...options.env, ...runtime.env },
      stdio: ['pipe', 'pipe', 'pipe'],
      signal: options.signal,
      windowsHide: true,
    })
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => onStderr(chunk))
    child.on('error', (error) => onStderr(`[spawn error] ${error.message}\n`))
    return child
  }
}
