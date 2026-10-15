import type { AgentDefinition } from '@anthropic-ai/claude-agent-sdk'
import type { PreToolUseOutcome, SessionHooks, ToolUse } from '../session/hooks'
import { DELEGATE_TOOL } from '../openai-session/tools/delegate'
import { isSubagentTool } from '../permissions/tool-classes'
import { isResearchDelegation, RESEARCH_SUB_AGENT } from './sub-agent-index'

/** The engine's own tools research reaches the internet with. */
const NETWORK_TOOLS = ['WebSearch', 'WebFetch']

/** The research sub agent as the Claude engine takes it: its own instructions, searching and fetching, and nothing that reads the code. */
export function claudeResearchAgent(): AgentDefinition {
  return { description: RESEARCH_SUB_AGENT.description, prompt: RESEARCH_SUB_AGENT.prompt, tools: [...NETWORK_TOOLS] }
}

/**
 * A mode's tool set as the Claude engine's base set. A sub agent there never
 * reaches a built-in its parent's base set leaves out, so a set that
 * delegates carries the engine's sub agent tool and what research reaches the
 * internet with; `ResearchOnlyDelegation` keeps both to research alone.
 */
export function claudeBaseTools(toolNames: readonly string[]): string[] {
  return toolNames.includes(DELEGATE_TOOL) ? [...toolNames, 'Agent', ...NETWORK_TOOLS] : [...toolNames]
}

/**
 * Holds a scoped session on the Claude engine to research as its only sub
 * agent, and keeps searching and fetching inside that research: the engine's
 * other sub agents read whatever they like, which a scoped session may not.
 */
export class ResearchOnlyDelegation implements SessionHooks {
  async preToolUse(tool: ToolUse): Promise<PreToolUseOutcome> {
    if (isSubagentTool(tool.toolName) && !isResearchDelegation(tool.toolName, tool.input))
      return { deny: `Only the \`${RESEARCH_SUB_AGENT.name}\` sub agent is offered in this session.` }
    if (NETWORK_TOOLS.includes(tool.toolName) && tool.agent !== RESEARCH_SUB_AGENT.name)
      return { deny: `${tool.toolName} is not available here; hand the question to the \`${RESEARCH_SUB_AGENT.name}\` sub agent instead.` }
    return undefined
  }
}
