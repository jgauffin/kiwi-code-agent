import { splitShellCommand } from '../permissions/shell-split'
import type { PreToolUseOutcome, SessionHooks, ToolUse } from '../session/hooks'

/** Said in every prompt, so RunScript is the model's first move rather than the gate's correction. */
export const SCRIPT_WRITING =
  'For a program over files (the same edit across files, a regex rewrite, parsing JSON, XML or HTML, cross-referencing contents) use RunScript, not python, node or powershell through the shell: its JavaScript reads, greps, globs and runs shell commands, and its edits reach the user as one diff.'

const SHELL_TOOLS = new Set(['Bash', 'PowerShell'])

/** Per interpreter, whether its arguments carry the program inline rather than naming a file. */
const INLINE: Record<string, (args: string[], heredoc: boolean) => boolean> = {
  python: (args, heredoc) => args.includes('-c') || args.includes('-') || (args.length === 0 && heredoc),
  node: (args, heredoc) => args.some((a) => ['-e', '--eval', '-p', '--print', '-'].includes(a)) || (args.length === 0 && heredoc),
  deno: (args) => args[0] === 'eval',
  perl: (args) => args.some((a) => /^-[a-zA-Z]*[eE]$/.test(a)),
  powershell: (args) => args.some((a) => ['-command', '-c', '-encodedcommand'].includes(a.toLowerCase())),
}
const ALIASES: Record<string, string> = { python3: 'python', py: 'python', bun: 'node', ruby: 'perl', pwsh: 'powershell' }

/**
 * Answers the first shell command that runs an inline program with a pointer
 * to RunScript. The same command again goes through: a zip, a binary file or
 * a network probe is beyond the sandbox, and the model is the judge of that.
 */
export class ScriptGate implements SessionHooks {
  private readonly pointed = new Set<string>()

  async preToolUse(tool: ToolUse): Promise<PreToolUseOutcome> {
    if (!SHELL_TOOLS.has(tool.toolName)) return undefined
    const command = (tool.input as { command?: unknown } | null)?.command
    if (typeof command !== 'string' || this.pointed.has(command) || !runsInlineProgram(command)) return undefined
    this.pointed.add(command)
    return {
      deny: [
        'This runs a program through the shell. Write it for RunScript instead: read, write, edit, replace, glob, grep, readdir, jsonQuery and bash are its functions, and its edits go to the user as one diff (the run-script skill has examples).',
        'If it needs what RunScript cannot do (a library, a binary or zip file, the network), run the same command again.',
      ].join('\n'),
    }
  }
}

function runsInlineProgram(command: string): boolean {
  return splitShellCommand(command).segments.some(({ tokens, text }) => {
    const name = interpreter(tokens[0] ?? '')
    return name !== undefined && INLINE[name]!(tokens.slice(1), text.includes('\n'))
  })
}

function interpreter(word: string): string | undefined {
  const base = word.split(/[\\/]/).pop()!.toLowerCase().replace(/\.exe$/, '')
  const name = ALIASES[base] ?? base
  return name in INLINE ? name : undefined
}
