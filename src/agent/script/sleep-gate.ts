import { splitShellCommand } from '../permissions/shell-split'
import type { PreToolUseOutcome, SessionHooks, ToolUse } from '../session/hooks'

const SHELL_TOOLS = new Set(['Bash', 'PowerShell', 'BackgroundBash'])

/** A pause between retries is fine; anything longer is the model waiting for something it should be told about. */
export const LONGEST_SLEEP_SECONDS = 5

const REFUSAL =
  'Do not sleep for more than five seconds. If a background command is running, wait for its notice of exit; to wait for a condition (a port, a file, a URL, output), use BackgroundWait; to look at this again later, schedule your return. A sleep of five seconds or less, between retries, is fine.'

/** Refuses a shell command that sleeps for more than five seconds, whether it runs in the foreground or as a background command. */
export class SleepGate implements SessionHooks {
  async preToolUse(tool: ToolUse): Promise<PreToolUseOutcome> {
    if (!SHELL_TOOLS.has(tool.toolName)) return undefined
    const command = (tool.input as { command?: unknown } | null)?.command
    if (typeof command !== 'string' || !sleepsLong(command)) return undefined
    return { deny: REFUSAL }
  }
}

function sleepsLong(command: string): boolean {
  return splitShellCommand(command).segments.some(({ tokens }) => {
    const name = (tokens[0] ?? '').split(/[\\/]/).pop()!.toLowerCase().replace(/\.exe$/, '')
    const args = tokens.slice(1)
    switch (name) {
      case 'sleep':
        // GNU sleep adds its operands together: `sleep 3 3` is six seconds.
        return args.filter((a) => !a.startsWith('-')).reduce((sum, a) => sum + unitSeconds(a), 0) > LONGEST_SLEEP_SECONDS
      case 'start-sleep':
        return powershellSeconds(args) > LONGEST_SLEEP_SECONDS
      case 'timeout':
        return windowsTimeoutSeconds(args) > LONGEST_SLEEP_SECONDS
      default:
        return false
    }
  })
}

function unitSeconds(word: string): number {
  const match = /^(\d*\.?\d+)([smhd]?)$/i.exec(word)
  if (!match) return 0
  const factor = { '': 1, s: 1, m: 60, h: 3600, d: 86400 }[match[2]!.toLowerCase() as '' | 's' | 'm' | 'h' | 'd']
  return Number(match[1]) * factor
}

function powershellSeconds(args: string[]): number {
  let seconds = 0
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!.toLowerCase()
    const next = Number(args[i + 1])
    if (/^-(s|se|sec|seconds?)$/.test(arg) && !Number.isNaN(next)) seconds += next
    else if (/^-(m|ms|milliseconds?)$/.test(arg) && !Number.isNaN(next)) seconds += next / 1000
    else if (!arg.startsWith('-') && !Number.isNaN(Number(arg)) && (i === 0 || !args[i - 1]!.startsWith('-'))) seconds += Number(arg)
  }
  return seconds
}

/** Only the Windows form, `timeout /t 10`: GNU `timeout 10 cmd` limits a command and does not sleep. */
function windowsTimeoutSeconds(args: string[]): number {
  const at = args.findIndex((a) => a.toLowerCase() === '/t')
  if (at < 0) return 0
  const seconds = Number(args[at + 1])
  return Number.isNaN(seconds) ? 0 : seconds
}
