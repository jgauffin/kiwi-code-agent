import { compileTemplate } from '@relax.js/core/html'
import type { CleanupUnit, PlanState } from '../protocol'
import { CleanupDecidedEvent } from './events'
import { offeredUnits } from './plan-step'
import { PlanTab } from './plan-tab'
import { post } from './vscode-api'

type UnitRow = { name: string; measure: string; at: string; line: string }
type FileRow = { path: string; openTitle: string; picked: boolean; units: UnitRow[] }

/**
 * What the size sweep found once the tests passed, by file, and the ways out
 * of it. Nothing is split until the user says so: the code was just proven,
 * and a split is a change to it. Every file starts picked; the user narrows
 * the split to the files worth it.
 */
export class PlanCleanupTab extends PlanTab {
  private readonly template = compileTemplate(`
    <section class="cleanup">
      <h2 class="heading">Cleanup</h2>
      <p class="note" if="offered">These units grew past the size limits while the feature was built. Splitting them changes shape, never behaviour.</p>
      <div class="toolbar" if="offered">
        <button type="button" class="toggle" r-click="toggleAll()">{{toggleLabel}}</button>
        <span class="count">{{count}}</span>
      </div>
      <ul class="files" if="offered">
        <li loop="f in files" class="entry">
          <label class="pick">
            <input type="checkbox" checked="{{f.picked}}" r-change="pick(f, event)">
            <button type="button" class="link file" title="{{f.openTitle}}" r-click="open(f.path)">{{f.path}}</button>
          </label>
          <ul class="units">
            <li loop="u in f.units" class="unit">
              <span class="text"><strong class="name">{{u.name}}</strong>{{u.measure}}</span>
              <button type="button" class="link file" title="{{f.openTitle}}" r-click="open(u.at)">{{u.line}}</button>
            </li>
          </ul>
        </li>
      </ul>
      <div class="choices" if="offered">
        <button type="button" disabled="{{nonePicked}}" title="Split the units in the files picked, in a run of their own. Behaviour and tests stay as they are." r-click="decide('run', 'picked')">{{selectedLabel}}</button>
        <button type="button" title="Split every unit listed, whatever is picked." r-click="decide('run', 'all')">Clean up all</button>
        <button type="button" title="Leave the offer standing. The feature keeps its place in the plan list until the cleanup is settled." r-click="decide('postpone')">{{laterLabel}}</button>
        <button type="button" title="The feature is finished as it stands; this is not offered again." r-click="decide('skip')">Skip</button>
        <p class="note" if="postponed">Postponed. The feature stays on the plan list until this is settled.</p>
      </div>
      <p class="{{settledClass}}" if="settled">{{settledText}}</p>
    </section>
  `)
  /** Files the user took out of the cleanup; every file is picked until named here. */
  private unpicked = new Set<string>()

  protected draw(plan: PlanState): void {
    if (this.childElementCount === 0) this.appendChild(this.template.content)
    const units = offeredUnits(plan)
    const files = this.fileRows(units)
    const picked = files.filter((f) => f.picked)
    const offered = files.length > 0
    const settled = offered ? undefined : settledLine(plan)
    this.template.render(
      {
        offered,
        toggleLabel: picked.length > 0 ? 'Select none' : 'Select all',
        count: `${picked.length} of ${files.length} files`,
        files,
        nonePicked: picked.length === 0,
        selectedLabel: `Clean up selected (${picked.length})`,
        laterLabel: plan.cleanupDecision === 'postponed' ? 'Still later' : 'Later',
        postponed: plan.cleanupDecision === 'postponed',
        settled: settled !== undefined,
        settledClass: settled?.className ?? '',
        settledText: settled?.text ?? '',
      },
      {
        toggleAll: () => this.toggleAll(files),
        pick: (f: FileRow, event: Event) => this.pick(f.path, (event.target as HTMLInputElement).checked),
        open: (path: string) => post({ type: 'open_file', path }),
        decide: (decision: 'run' | 'postpone' | 'skip', which?: 'picked' | 'all') => this.decide(decision, files, which),
      },
    )
  }

  /** One row per file the sweep named, with the units in it and whether it is still in the split. */
  private fileRows(units: CleanupUnit[]): FileRow[] {
    return [...new Set(units.map((u) => u.path))].map((path) => ({
      path,
      openTitle: `Open ${path}`,
      picked: !this.unpicked.has(path),
      units: units
        .filter((u) => u.path === path)
        .map((u) => ({ name: u.name, measure: `: ${u.kind}, ${u.lines} lines, limit ${u.threshold}`, at: path, line: `:${u.line}` })),
    }))
  }

  /** One button for the whole list: everything is picked, or nothing, so the user starts from either end. */
  private toggleAll(files: FileRow[]): void {
    const some = files.some((f) => f.picked)
    this.unpicked = new Set(some ? files.map((f) => f.path) : [])
    this.redraw()
  }

  private pick(path: string, picked: boolean): void {
    if (picked) this.unpicked.delete(path)
    else this.unpicked.add(path)
    this.redraw()
  }

  private decide(decision: 'run' | 'postpone' | 'skip', files: FileRow[], which?: 'picked' | 'all'): void {
    const paths = which === 'all' ? files.map((f) => f.path) : which === 'picked' ? files.filter((f) => f.picked).map((f) => f.path) : undefined
    this.dispatchEvent(new CleanupDecidedEvent(decision, paths))
  }
}

/** Where a settled cleanup stands: the run in flight, what it did, or the decision that ended it. */
function settledLine(plan: PlanState): { className: string; text: string } | undefined {
  if (plan.cleanup?.live) return { className: 'running', text: plan.cleanup.text }
  if (plan.cleanupDecision === 'skipped') return { className: 'note', text: 'Cleanup skipped: the feature stands as it is.' }
  if (plan.cleanup) return { className: 'ran', text: plan.cleanup.text }
  if (plan.cleanupDecision === 'done') return { className: 'note', text: 'The split has been made.' }
  return undefined
}

customElements.define('plan-cleanup-tab', PlanCleanupTab)
