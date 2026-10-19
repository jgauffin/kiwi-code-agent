import { z } from 'zod'
import { fail, ok, type Tool } from '../agent/openai-session/tools/tool'
import type { AgentExchange } from './agent-exchange'

const schema = z.object({
  text: z
    .string()
    .min(1)
    .describe('What to tell or ask the other agent, self-contained since it does not see your conversation, and succinct: the facts or the question, nothing more.'),
})

export const SEND_TO_LINKED_AGENT_TOOL = 'SendToLinkedAgent'

/** The tool one chat session's agent is offered to reach the agent of the session linked to it in another window. */
export function sendToLinkedAgentTool(sessionId: string, exchange: AgentExchange): Tool<typeof schema> {
  return {
    name: SEND_TO_LINKED_AGENT_TOOL,
    description:
      'Send a message to the agent of the chat session linked to this one in another VS Code window, for instance a contract change to keep in step. Be succinct and to the point: say what changed on your side, what you need from theirs, or what you ask, with no preamble or recap. Do not tell the other agent how to do its own side; it knows its code and decides that itself. It returns at once; the answer arrives as a message from that agent, on your next tool result or as your next turn. It is refused when the link is not usable or the agents have exchanged too many messages without a word from the person.',
    schema,
    // Reaching another agent changes no file of this workspace.
    readOnly: true,
    async execute(input) {
      const outcome = await exchange.send(sessionId, input.text)
      return outcome.ok ? ok('Sent.') : fail(outcome.reason)
    },
  }
}
