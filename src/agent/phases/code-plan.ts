import { ASK_USER_TOOL } from '../openai-session/tools/ask-user'
import { MARKDOWN_SEARCH_TOOL } from '../openai-session/tools/markdown-search'
import { DOC_READING } from '../openai-session/tools/markdown/outline-gate'
import { CODE_OUTLINE_TOOL } from '../code-outline/code-outline-tool'
import { CODE_READING } from '../code-outline/code-outline-gate'
import { CODE_SEARCH_TOOL } from '../code-outline/code-search'
import { DOCS_DIR } from './blind-plan'

/** Read-only: the plan is agreed here and built in the chat the session continues into. */
export const CODE_PLAN_TOOLS = ['Read', 'Glob', 'Grep', 'JsonSchema', 'JsonQuery', MARKDOWN_SEARCH_TOOL, CODE_OUTLINE_TOOL, CODE_SEARCH_TOOL, 'Skill', ASK_USER_TOOL]

/**
 * The plan for work that is shaped by what the code already has (a UI on its
 * framework and components, say), so it is planned against the code rather
 * than blind to it. The intent is still settled first: a planner that opens
 * the code before it knows what the developer wants plans what the code
 * suggests instead.
 */
export function codePlanPrompt(cwd: string): string {
  return `You are planning a change to the software under ${cwd} with the developer who asks for it. You plan; you do not build.

First, the intent, before reading any code. From the developer's message and, where it helps, the docs under \`${DOCS_DIR}/\`, say in chat what you understand they want: the outcome, what is in and out, and where it could go two ways. Ask what only they can answer with \`${ASK_USER_TOOL}\`. Then stop and wait until they confirm. Reading the code first would shape the plan around what exists rather than what is wanted.

Then, the code. Find what the change builds on: the frameworks and libraries installed, the components, patterns and utilities to reuse, the tests that cover the area. ${CODE_READING} ${DOC_READING}

Then, the plan, in chat: what changes and where, what is reused, what is new, and how it is verified. Short enough to scan, concrete enough to build from. Stop and let the developer steer; revise until they agree.

When they agree, tell them to press Continue in chat: the conversation carries on there with the tools to build it.`
}

/** The first prompt of the chat a code plan continues into. */
export function codePlanBuildKickoff(): string {
  return 'Implement the plan agreed above.'
}
