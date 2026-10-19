import type { SessionEvent } from '../../agent/session/code-session'
import { isShellTool, isSubagentTool } from '../../agent/permissions/tool-classes'
import { renderAnsi } from './ansi'
import { fillCode } from './highlight'
import { lineRange, shellCall, subagentName, summarizeInput } from './tool-input'
import { agentTag, showEdit, subAgentStatus } from './transcript-blocks'

type Insert = (element: HTMLElement, parentToolUseId?: string) => void

/** The tool-call steps of a transcript, and the results that attach to them. */
export class ToolSteps {
  private readonly tools = new Map<string, HTMLDetailsElement>()
  /** The agent each subagent step runs, by the call that spawned it: what the output nested under it is named after. */
  private readonly agents = new Map<string, string>()
  /** The thread each call belongs to, so a prompt about one lands where the call sits and not at the end of the transcript. */
  private readonly toolThreads = new Map<string, string | undefined>()
  /** Tool calls of the question tool: the card says what they ask, so their own rows say nothing. */
  private readonly questionCalls = new Set<string>()
  /** Tool calls still without a result, by id, each named as its row is. */
  private readonly pendingTools = new Map<string, string>()
  /** The newest edit the user has not seen, the one edit step left open. */
  private openEdit: HTMLDetailsElement | undefined

  clear(): void {
    this.tools.clear()
    this.agents.clear()
    this.toolThreads.clear()
    this.questionCalls.clear()
    this.pendingTools.clear()
    this.openEdit = undefined
  }

  /** The step a call is shown in, if it is shown. */
  step(toolUseId: string): HTMLDetailsElement | undefined {
    return this.tools.get(toolUseId)
  }

  threadOf(toolUseId: string): string | undefined {
    return this.toolThreads.get(toolUseId)
  }

  markQuestionCall(toolUseId: string): void {
    this.questionCalls.add(toolUseId)
  }

  isQuestionCall(toolUseId: string): boolean {
    return this.questionCalls.has(toolUseId)
  }

  /** The newest call of the main thread still running, as its row names it. */
  latestPending(): string | undefined {
    return [...this.pendingTools.values()].at(-1)
  }

  trackPending(event: Extract<SessionEvent, { type: 'tool_call' }>, details: HTMLDetailsElement): void {
    this.pendingTools.set(event.toolUseId, `Running ${details.querySelector('summary')?.textContent ?? event.name}`)
  }

  finishPending(toolUseId: string): void {
    this.pendingTools.delete(toolUseId)
  }

  call(event: Extract<SessionEvent, { type: 'tool_call' }>): HTMLDetailsElement {
    const details = document.createElement('details')
    details.className = 'tool'
    const summary = document.createElement('summary')
    const input = document.createElement('pre')
    input.className = 'input'
    const shell = isShellTool(event.name) ? shellCall(event.input) : undefined
    const spawns = isSubagentTool(event.name) ? subagentName(event.input) : undefined
    if (spawns) this.agents.set(event.toolUseId, spawns)
    if (shell) {
      // A shell step is named by what it is for; its body is the commands it runs, one per line.
      summary.textContent = shell.description ?? summarizeInput(event.input)
      fillCode(input, shell.lines.join('\n'), 'bash')
    } else {
      // A step that spawns an agent is named with the agent, so the thread it opens is read as that agent's.
      summary.textContent = `${spawns ? `${event.name} (${spawns})` : event.name} ${summarizeInput(event.input)}${lineRange(event.input)}`
      fillCode(input, JSON.stringify(event.input, null, 2), 'json')
    }
    if (event.parentToolUseId) {
      details.classList.add('from-subagent')
      summary.prepend(agentTag(this.agentLabel(event.parentToolUseId)))
    }
    details.append(summary, input)
    this.tools.set(event.toolUseId, details)
    this.toolThreads.set(event.toolUseId, event.parentToolUseId)
    return details
  }

  /** The agent whose thread this output came from; one whose spawning step never arrived is named only as a subagent. */
  agentLabel(parentToolUseId: string): string {
    return this.agents.get(parentToolUseId) ?? 'subagent'
  }

  /** A result goes into its call's step; one whose call is not shown stands on its own. */
  result(event: Extract<SessionEvent, { type: 'tool_result' }>, approvedByHand: boolean, insert: Insert): void {
    const details = this.tools.get(event.toolUseId)
    const result = document.createElement('pre')
    result.className = event.isError ? 'result error' : 'result'
    renderAnsi(event.text, result)
    if (!details) {
      insert(result, event.parentToolUseId)
      return
    }
    details.classList.add('done')
    details.classList.toggle('failed', event.isError)
    // A delegation's row names its status and what it spent beside its task, not only inside the expanded result.
    if (event.subAgent) details.querySelector('summary')?.appendChild(subAgentStatus(event.subAgent))
    // A written file speaks through its diff; the tool's confirmation says nothing more.
    if (event.edit && !event.isError) {
      // An edit the user allowed at a prompt has already been read; one that ran on its own has not.
      const unread = !approvedByHand
      showEdit(details, event.edit, unread)
      // Only the newest unread edit stays open, so a run of edits does not bury the conversation.
      if (unread) {
        if (this.openEdit) this.openEdit.open = false
        this.openEdit = details
      }
      return
    }
    if (event.edit) showEdit(details, event.edit, true)
    details.appendChild(result)
  }
}
