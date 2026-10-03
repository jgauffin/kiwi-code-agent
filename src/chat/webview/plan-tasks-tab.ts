import { compileTemplate } from '@relax.js/core/html'
import type { PlanState } from '../protocol'
import type { Task } from '../../agent/phases/tasks-file'
import { PlanTab } from './plan-tab'
import { blockedReason, same, TASK_STATE } from './plan-parts'
import { onlyBlockedLeft } from './plan-step'
import { post } from './vscode-api'
import './markdown-text'

type TaskRow = {
  className: string
  name: string
  rest: string
  removed: boolean
  stated: boolean
  state: string
  stateLabel: string
  /** Blocked with nothing else left to build: the row offers Hand back and Accept as is. */
  decidable: boolean
  gap: boolean
  gapText: string
  hasFiles: boolean
  files: string[]
  hasContext: boolean
  context: string[]
  hasHow: boolean
  how: string
}
type Group = { title: string; titled: boolean; tasks: TaskRow[] }

/** Tasks as the board groups them: under the heading the mapping put them, in file order. */
export class PlanTasksTab extends PlanTab {
  private readonly template = compileTemplate(`
    <section class="tasks">
      <h2 class="heading" title="{{tasksPath}}">Tasks</h2>
      <div loop="g in groups" class="group">
        <h3 class="heading" if="g.titled">{{g.title}}</h3>
        <ul class="board">
          <li loop="t in g.tasks" class="{{t.className}}">
            <div class="line">
              <span class="text"><strong class="name">{{t.name}}</strong>{{t.rest}}</span>
              <span class="badge removed" if="t.removed">removed</span>
              <span class="badge state {{t.state}}" if="t.stated">{{t.stateLabel}}</span>
              <span class="badge gap" if="t.gap">{{t.gapText}}</span>
            </div>
            <div class="paths" if="t.hasFiles">
              <span class="kind">changes</span>
              <ul class="files">
                <li loop="p in t.files" class="file"><button type="button" class="link file" title="Open {{p}}" r-click="open(p)">{{p}}</button></li>
              </ul>
            </div>
            <div class="paths" if="t.hasContext">
              <span class="kind">reads</span>
              <ul class="context">
                <li loop="p in t.context" class="file"><button type="button" class="link file" title="Open {{p}}" r-click="open(p)">{{p}}</button></li>
              </ul>
            </div>
            <details class="how" if="t.hasHow">
              <summary>how</summary>
              <markdown-text class="body" block text="{{t.how}}"></markdown-text>
            </details>
            <div class="decide" if="t.decidable">
              <button type="button" title="Hand the task back to the run that blocked it, in its own conversation, told what blocked it." r-click="handBack(t.name)">Hand back</button>
              <button type="button" title="Count the task as finished without a test. The board records that you accepted it and why it was blocked; its rules stay without proof." r-click="accept(t.name)">Accept as is</button>
            </div>
          </li>
        </ul>
      </div>
      <p class="verification {{verdict}}" if="verified"><span class="kind">{{verdictLabel}}</span><span class="text">{{verdictText}}</span></p>
    </section>
  `)

  protected draw(plan: PlanState): void {
    if (this.childElementCount === 0) this.appendChild(this.template.content)
    const record = plan.lastVerification
    // A pass with nothing run proves nothing, so it is not called one.
    const none = record?.runs?.length === 0
    // A blocked task is the person's once the build has nothing else to do.
    const deciding = plan.status !== 'draft' && !plan.atWork && onlyBlockedLeft(plan.tasks.filter((t) => !t.removed))
    this.template.render(
      {
        tasksPath: plan.tasksPath,
        // The build owns the board once the spec is approved; a draft's board is a plan, not progress.
        groups: grouped(plan.tasks, plan.status !== 'draft', deciding),
        verified: record !== undefined,
        verdict: none ? 'none' : record?.ok === false ? 'failed' : 'ok',
        verdictLabel: none ? 'no tests ran' : record?.ok ? 'tests passed' : 'tests failed',
        verdictText: record ? `${record.text} (${record.at})` : '',
      },
      {
        open: (path: string) => post({ type: 'open_file', path }),
        handBack: (task: string) => post({ type: 'hand_back_task', task }),
        accept: (task: string) => post({ type: 'accept_task', task }),
      },
    )
  }
}

/** Runs of tasks that share a heading, in the order the file has them. */
function grouped(tasks: Task[], stated: boolean, deciding: boolean): Group[] {
  const groups: Group[] = []
  for (const task of tasks) {
    const title = task.group ?? ''
    const row = taskRow(task, stated, deciding)
    const last = groups.at(-1)
    if (last && last.title === title) last.tasks.push(row)
    else groups.push({ title, titled: title !== '', tasks: [row] })
  }
  return groups
}

/**
 * A task as work the reader can judge: what it does in the mapper's own
 * sentence, where it stands, the paths it changes and the ones it reads, and
 * the build steps on demand. A bare list of paths explains nothing.
 */
function taskRow(task: Task, stated: boolean, deciding: boolean): TaskRow {
  const unproven = task.state === 'tested' ? task.delivers.filter((d) => !task.proves.some((p) => same(p.item, d))) : []
  const state = task.accepted !== undefined ? 'accepted' : task.state
  return {
    className: `task ${state}${task.removed ? ' removed' : ''}`,
    name: task.name,
    rest: task.text ? `: ${task.text}` : '',
    removed: task.removed,
    stated: !task.removed && stated,
    state,
    stateLabel: blockedReason(task) ?? (task.accepted !== undefined ? `accepted untested: ${task.accepted}` : TASK_STATE[task.state]),
    decidable: deciding && !task.removed && task.state === 'blocked',
    gap: !task.removed && stated && unproven.length > 0,
    gapText: `no test for ${unproven.join(', ')}`,
    hasFiles: task.files.length > 0,
    files: task.files,
    hasContext: task.context.length > 0,
    context: task.context,
    hasHow: task.how.trim() !== '',
    how: task.how,
  }
}

customElements.define('plan-tasks-tab', PlanTasksTab)
