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

export function hostExecutableAsNode(execPath: string): NodeRuntime {
  return { command: execPath, args: [], env: { ELECTRON_RUN_AS_NODE: '1' } }
}

/**
 * Spawn function for `Options.spawnClaudeCodeProcess`. With a runtime, the
 * engine is a JavaScript file the SDK passes as the first argument and the
 * runtime runs it; without one the engine is a native Claude Code that starts
 * itself, and only the command it was given is swapped for nothing.
 *
 * The SDK reports every ENOENT as "executable not found at <cli path>", so
 * the things that can actually be missing are checked here first and named.
 */
export function spawnWithRuntime(runtime: NodeRuntime | undefined, onStderr: (line: string) => void) {
  return (options: SpawnOptions): SpawnedProcess => {
    const enginePath = runtime ? options.args[0] : options.command
    if (enginePath && !existsSync(enginePath)) throw new Error(`Engine missing: ${enginePath}`)
    if (options.cwd && !existsSync(options.cwd)) throw new Error(`Working directory missing: ${options.cwd}`)
    if (runtime && (runtime.command.includes('/') || runtime.command.includes('\\'))) {
      if (!existsSync(runtime.command)) throw new Error(`Node runtime missing: ${runtime.command}`)
    }
    const command = runtime?.command ?? options.command
    const args = runtime ? [...runtime.args, ...options.args] : options.args
    onStderr(`[spawn] ${command} ${args.join(' ')} (cwd ${options.cwd})\n`)
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...options.env, ...(runtime?.env ?? {}) },
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
