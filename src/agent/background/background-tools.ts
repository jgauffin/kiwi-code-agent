import { z } from 'zod'
import type { SessionHooks } from '../session/hooks'
import { fail, ok, type Tool } from '../openai-session/tools/tool'
import { describeEnds, type BackgroundCommands } from './background-commands'
import { BACKGROUND_WAIT_TOOL, backgroundWaitTool } from './wait-tool'

export const BACKGROUND_BASH_TOOL = 'BackgroundBash'
export const BACKGROUND_LIST_TOOL = 'BackgroundList'
export const BACKGROUND_STOP_TOOL = 'BackgroundStop'

/** The names a session's tool set lists to be offered background commands. */
export const BACKGROUND_TOOLS = [BACKGROUND_BASH_TOOL, BACKGROUND_LIST_TOOL, BACKGROUND_STOP_TOOL, BACKGROUND_WAIT_TOOL]

const startSchema = z.object({
  command: z.string().describe('Shell command to run in the background'),
  purpose: z.string().min(1).describe('What you are waiting for it to do, in a few words; you are reminded of it when the command ends'),
})
const noInput = z.object({})
const stopSchema = z.object({ id: z.string().describe('The id the command was started with') })

/**
 * Commands that outlive the call: the model gets an id at once and is told when the
 * command exits, so it never has to sit and watch or sleep and look.
 */
export function backgroundTools(sessionId: string, commands: BackgroundCommands): Tool[] {
  const start: Tool<typeof startSchema> = {
    name: BACKGROUND_BASH_TOOL,
    description:
      'Runs a shell command (bash, Git Bash on Windows) in the background and returns its id at once. Its output is written to a file in your scratch folder as it runs, which you read like any file. ' +
      'You are told when it exits, with its exit code and the last lines of its output, so do not poll it or sleep. Use it for a build, a test suite or a server that takes long. Judged exactly as the same command run with Bash.',
    schema: startSchema,
    readOnly: false,
    async execute(input, ctx) {
      const started = commands.start(sessionId, input.command, input.purpose, ctx.cwd)
      return ok(`Started ${started.id}. Its output is written to ${started.outputFile} as it runs. You will be told when it ends.`)
    },
  }
  const list: Tool<typeof noInput> = {
    name: BACKGROUND_LIST_TOOL,
    description: 'Lists the background commands you started that are still running: id, command, what it is for and where its output is.',
    schema: noInput,
    readOnly: true,
    async execute() {
      const running = commands.runningOf(sessionId)
      if (running.length === 0) return ok('No background command is running.')
      return ok(running.map((c) => `${c.id}: ${c.command} (for: ${c.purpose}), output in ${c.outputFile}`).join('\n'))
    },
  }
  const stop: Tool<typeof stopSchema> = {
    name: BACKGROUND_STOP_TOOL,
    description: 'Stops a running background command you started, by its id.',
    schema: stopSchema,
    // It ends only what this session itself started.
    readOnly: true,
    async execute(input) {
      return commands.stop(sessionId, input.id) ? ok(`Stopped ${input.id}.`) : fail(`No background command ${input.id} is running.`)
    },
  }
  return [start, list, stop, backgroundWaitTool(sessionId, commands)] as Tool[]
}

/**
 * Tells the session, as a tail on its next tool result, of the commands that
 * exited during the turn, instead of interrupting it.
 */
export class BackgroundNotices implements SessionHooks {
  constructor(
    private readonly sessionId: string,
    private readonly commands: BackgroundCommands,
  ) {}

  async postToolUse(tool: { agent?: string }): Promise<{ additionalContext: string } | undefined> {
    // A delegated run's own calls are not the session's to be told on.
    if (tool.agent) return undefined
    const ended = this.commands.takeEnded(this.sessionId)
    return ended.length === 0 ? undefined : { additionalContext: describeEnds(ended) }
  }
}
