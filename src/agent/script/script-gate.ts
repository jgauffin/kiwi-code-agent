import { splitShellCommand } from '../permissions/shell-split'
import type { PreToolUseOutcome, SessionHooks, ToolUse } from '../session/hooks'

/**
 * Said in every prompt with RunScript, so it is the model's first move rather than the gate's correction.
 * It draws the line against batched Reads: a script for an answer that is computed, a Read for code the
 * model has to see, and always a Read before a hand edit, since a script's read does not mark the file read.
 */
export const SCRIPT_WRITING =
  'The same change in more than two files is one RunScript, not a tool call per file, and so is a question about several files whose answer is computed (a count, which files match, what refers to what) rather than read: its JavaScript reads, greps, globs and searches code, returns only what you ask for, and its changes reach the user as one diff. Use it too for what you would write in python, node or powershell through the shell, such as a regex rewrite or parsing XML or HTML; to look inside JSON, JsonQuery and JsonSchema are cheaper. When you need to see the code itself, Read it, and Read a file before you edit it by hand: a read inside a script does not count for Edit.'

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
        'This runs a program through the shell. Write it for RunScript instead: read, write, edit, replace, move, glob, grep, codeSearch, readdir and jsonQuery are among its functions, and its changes go to the user as one diff (the run-script skill has examples).',
        'If it needs what RunScript cannot do (a shell command, a library, a binary or zip file, the network), run the same command again.',
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
