import type { PlanState } from '../protocol'
import type { Decision } from '../../agent/phases/decisions'
import { KEEP_RULING } from '../../agent/phases/ruling'
import type { CommentRef, Review, ReviewComment, ReviewRound } from '../../agent/phases/plan-review'
import type { Item, Scenario, Spec } from '../../agent/phases/spec-model'
import type { Task, TaskState } from '../../agent/phases/tasks-file'
import { PlanFocusRequestedEvent, ReviewActionEvent, type PlanFocus } from './events'
import { renderMarkdown, renderMarkdownInline } from './markdown'
import { presentTabs, type Tab } from './plan-step'
import { post } from './vscode-api'

const PLAN_TARGET = 'plan'
const MARKER = /\s*\[(?:in progress|done|tested|removed|applied|withdrawn|blocked[^\]]*)\]/gi

const TASK_STATE: Record<TaskState, string> = {
  open: 'open',
  in_progress: 'in progress',
  done: 'done',
  tested: 'tested',
  blocked: 'blocked',
}

const DECISION_STATE: Record<Decision['state'], string> = {
  open: 'to rule on',
  ruled: 'ruled',
  applied: 'applied',
  withdrawn: 'withdrawn',
}

/** A comment box on a rule or the plan, an edit of a pending comment, or a ruling being written on a decision. */
type Editor = { kind: 'comment'; target: string; comment?: CommentRef; text: string } | { kind: 'ruling'; target: string; text: string }

/** A comment with its place in the review, which is how the host addresses it. */
type PlacedComment = { ref: CommentRef; comment: ReviewComment; pending: boolean }

const same = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase()

/**
 * One tab of the plan at a time: the spec as the contract reads it (goal,
 * scenarios, questions, with the review written on its rows), the review as
 * a batch, the decisions one at a time, or the task board. Which tab is the
 * app's call, made on the strip above; a link from one tab to a rule on
 * another asks the app the same way. Built by hand rather than from a
 * template so an open comment box keeps its text and caret while the plan
 * around it is re-rendered.
 */
export class PlanView extends HTMLElement {
  private plan: PlanState | undefined
  private editor: Editor | undefined
  private signature = ''
  private tab: Tab = 'spec'
  /** The pending decision the wizard shows, by title; the first open one when unset or gone. */
  private shown: string | undefined

  update(plan: PlanState | undefined, tab: Tab): void {
    const tabChanged = tab !== this.tab
    this.tab = tab
    const signature = JSON.stringify(
      plan
        ? {
            body: plan.body,
            stage: plan.stage,
            status: plan.status,
            review: plan.review,
            commentable: plan.commentable,
            tasks: plan.tasks,
            stale: plan.stale,
            lastVerification: plan.lastVerification,
            decisions: plan.decisions,
            applyingRulings: plan.applyingRulings,
            // What the step is read from beyond the files: a run in flight (not its progress line, which ticks), an implement session to start.
            mapping: plan.mapping?.live,
            verification: plan.verification?.live,
            cleanup: plan.cleanup?.live,
            implementable: plan.implementable,
            reviewingDocs: plan.reviewingDocs,
          }
        : null,
    )
    const changed = signature !== this.signature || tabChanged
    this.signature = signature
    this.plan = plan
    if (changed) this.draw()
  }

  /** Scroll to the first row needing an act, or to the item named, on the tab as drawn. */
  land(where: PlanFocus): void {
    const target = where.item
      ? [...this.querySelectorAll<HTMLElement>('[data-item]')].find((n) => same(n.dataset.item ?? '', where.item!))
      : where.scroll
        ? this.querySelector<HTMLElement>('.attention')
        : undefined
    target?.scrollIntoView?.({ block: 'center' })
  }

  private act(action: ConstructorParameters<typeof ReviewActionEvent>[0]): void {
    this.dispatchEvent(new ReviewActionEvent(action))
  }

  private openEditor(editor: Editor | undefined): void {
    this.editor = editor
    this.draw()
  }

  private draw(): void {
    this.replaceChildren()
    const plan = this.plan
    if (!plan?.body || !plan.spec) return
    const spec = plan.spec
    if (spec.problems.length > 0) {
      // Off contract: the file as written, so nothing the model put there is hidden, and no review on it until it is repaired.
      this.append(this.problemsBox(spec.problems))
      const raw = el('div', 'body')
      renderMarkdown(plan.body, raw, true)
      this.append(raw)
      return
    }
    // A tab whose content is gone (the last decision withdrawn, say) falls back to the spec.
    const tab = presentTabs(plan).includes(this.tab) ? this.tab : 'spec'
    switch (tab) {
      case 'spec':
        this.append(...this.specTab(plan, spec))
        break
      case 'review':
        this.append(this.reviewTab(plan))
        break
      case 'decisions':
        this.append(this.decisionsSection(plan))
        break
      case 'tasks':
        this.append(this.tasksSection(plan))
        break
    }
  }

  private problemsBox(problems: string[]): HTMLElement {
    const box = el('section', 'problems')
    box.append(el('h3', 'heading', 'Off contract'))
    const list = el('ul', 'list')
    for (const problem of problems) list.append(el('li', 'problem', problem))
    box.append(list, note('Repair from the plan bar: the planner rearranges the spec, the rules stay the rules.'))
    return box
  }

  // --- the spec tab -------------------------------------------------------------

  private specTab(plan: PlanState, spec: Spec): HTMLElement[] {
    const nodes: HTMLElement[] = []
    if (!plan.commentable && plan.review.rounds.length > 0) {
      nodes.push(note('This plan is approved. Its review is kept as the record of how it was reached; reopen or supersede the plan to comment again.'))
    }
    if (plan.stale) nodes.push(note(staleNote(pendingDecisions(plan).map((d) => d.title))))
    nodes.push(this.wholePlanRow(plan), this.goalSection(spec))
    for (const scenario of spec.scenarios) nodes.push(this.scenarioCard(scenario, plan))
    if (spec.questions.length > 0) nodes.push(this.questionsSection(spec, plan))
    return nodes
  }

  private wholePlanRow(plan: PlanState): HTMLElement {
    const row = el('div', 'item whole')
    row.dataset.item = PLAN_TARGET
    const line = el('div', 'line')
    line.append(el('span', 'text', 'The plan as a whole'))
    if (plan.commentable) line.append(button('Comment', () => this.openEditor({ kind: 'comment', target: PLAN_TARGET, text: '' })))
    row.append(line, ...this.attachments(plan, PLAN_TARGET))
    return row
  }

  private goalSection(spec: Spec): HTMLElement {
    const section = el('section', 'goal')
    section.append(el('h2', 'heading', 'Goal'))
    const prose = el('div', 'prose')
    renderMarkdown(spec.goal, prose, true)
    section.append(prose)
    return section
  }

  /** One scenario: its rules, each with the edge cases that qualify it indented beneath. */
  private scenarioCard(scenario: Scenario, plan: PlanState): HTMLElement {
    const card = el('section', 'scenario')
    card.append(el('h2', 'heading', scenario.title))
    if (scenario.intro) {
      const intro = el('div', 'prose intro')
      renderMarkdown(scenario.intro, intro, true)
      card.append(intro)
    }
    const rules = el('ul', 'rules')
    for (const behaviour of scenario.behaviours) {
      const row = this.itemRow(behaviour, plan, 'behaviour')
      if (behaviour.edges.length > 0) {
        const edges = el('ul', 'edges')
        for (const edge of behaviour.edges) edges.append(this.itemRow(edge, plan, 'edge'))
        row.append(edges)
      }
      rules.append(row)
    }
    card.append(rules)
    return card
  }

  private questionsSection(spec: Spec, plan: PlanState): HTMLElement {
    const section = el('section', 'questions')
    section.append(el('h2', 'heading', 'Open questions'))
    const list = el('ul', 'rules')
    for (const question of spec.questions) list.append(this.itemRow(question, plan, 'question'))
    section.append(list)
    return section
  }

  /**
   * A rule, edge case or question: its name as the lead-in, its text, and to
   * the right what the reader needs at a glance: a gap in coverage, a strike,
   * the intent link; what is in order stays quiet, and the review controls
   * show on hover.
   */
  private itemRow(item: Item, plan: PlanState, kind: 'behaviour' | 'edge' | 'question'): HTMLElement {
    const struck = struckItems(plan.review).some((s) => same(s, item.name))
    const row = el('li', `item ${kind}${struck || item.removed ? ' struck' : ''}`)
    row.dataset.item = item.name
    const line = el('div', 'line')
    const aside = el('span', 'aside')
    if (item.citation) {
      const link = fileLink(item.citation.split('#')[0]!, 'intent')
      link.classList.add('citation')
      link.title = item.citation
      aside.append(link)
    }
    if (item.removed) aside.append(el('span', 'badge removed', 'removed'))
    else if (struck) aside.append(el('span', 'badge struck', 'struck'))
    if (kind !== 'question') aside.append(...this.coverage(item.name, plan))
    aside.append(...this.controls(item.name, plan, true))
    line.append(named(item.name, item.text.replace(MARKER, '').trim()), aside)
    row.append(line, ...this.attachments(plan, item.name))
    return row
  }

  /** What builds the rule and what proves it, once there is a board to say so: a gap is a badge, what is in order a quiet mark. */
  private coverage(name: string, plan: PlanState): HTMLElement[] {
    if (plan.tasks.length === 0) return []
    const marks: HTMLElement[] = []
    const live = plan.tasks.filter((t) => !t.removed)
    const task = live.find((t) => t.delivers.some((d) => same(d, name)))
    if (task) {
      const chip = el('span', 'chip task', task.name)
      chip.title = `Delivered by ${task.name}: ${task.text.replace(MARKER, '').trim()}`
      marks.push(chip)
    } else marks.push(el('span', 'badge gap', 'no task'))
    if (plan.stage === 'under_development' || plan.stage === 'verification' || plan.stage === 'verified') {
      const proof = live.flatMap((t) => t.proves).find((p) => same(p.item, name))
      if (proof) {
        const link = fileLink(proof.file, '✓')
        link.classList.add('chip', 'proof')
        link.title = `Proven by ${proof.test} in ${proof.file}`
        marks.push(link)
      } else marks.push(el('span', 'badge gap', 'no test'))
    }
    return marks
  }

  private controls(name: string, plan: PlanState, strikeable: boolean): HTMLElement[] {
    if (!plan.commentable) return []
    const controls: HTMLElement[] = [button('Comment', () => this.openEditor({ kind: 'comment', target: name, text: '' }))]
    if (strikeable) {
      const struck = struckItems(plan.review).some((s) => same(s, name))
      const pending = pendingRound(plan.review)?.strikes.some((s) => same(s, name)) ?? false
      if (!struck) controls.push(button('Strike', () => this.act({ type: 'strike_item', item: name })))
      else if (pending) controls.push(button('Unstrike', () => this.act({ type: 'unstrike_item', item: name })))
    }
    const wrap = el('span', 'controls')
    wrap.append(...controls)
    return [wrap]
  }

  // --- the review tab -----------------------------------------------------------

  /** The rounds newest first: the one being written with its edits, the submitted ones with the planner's answers and Resolve. */
  private reviewTab(plan: PlanState): HTMLElement {
    const section = el('section', 'review')
    for (const round of [...plan.review.rounds].reverse()) section.append(this.roundSection(plan, round))
    return section
  }

  private roundSection(plan: PlanState, round: ReviewRound): HTMLElement {
    const pending = round.submittedAt === undefined
    const section = el('section', `round${pending ? ' pending' : ''}`)
    section.append(el('h2', 'heading', pending ? `Round ${round.number}, not submitted` : `Round ${round.number}`))
    if (round.comments.length === 0 && round.strikes.length === 0) section.append(note('Nothing in this round yet: comment on a rule on the Spec tab.'))
    const list = el('ul', 'comments')
    round.comments.forEach((comment, index) => list.append(this.commentRow({ ref: { round: round.number, index }, comment, pending }, plan, true)))
    if (round.comments.length > 0) section.append(list)
    if (round.strikes.length > 0) {
      const strikes = el('ul', 'strikes')
      for (const name of round.strikes) {
        const row = el('li', 'strike')
        row.append(el('span', 'label', 'remove: '), this.itemLink(name))
        if (pending && plan.commentable) row.append(button('Unstrike', () => this.act({ type: 'unstrike_item', item: name })))
        strikes.append(row)
      }
      section.append(strikes)
    }
    if (pending) section.append(note('Submit the review from the plan bar when it is complete.'))
    return section
  }

  /** The rule a comment or strike is on, as a link to its row on the Spec tab. */
  private itemLink(name: string): HTMLElement {
    const link = button(name === PLAN_TARGET ? 'the plan as a whole' : name, () => this.dispatchEvent(new PlanFocusRequestedEvent('spec', { item: name })))
    link.className = 'link item'
    link.title = 'Show the rule on the Spec tab.'
    return link
  }

  // --- decisions ----------------------------------------------------------------

  /**
   * A wizard over the decisions still in play: one at a time, both sides of
   * the disagreement and the ways to settle it as buttons, a pick moving on
   * to the next open one. Only the header steps between them, so nothing
   * under the card can be read as another way to settle this one. The settled
   * ones are folded away: an applied decision is history, its finding and
   * ruling the record, and its title no more than a footnote.
   */
  private decisionsSection(plan: PlanState): HTMLElement {
    const section = el('section', 'decisions')
    const pending = pendingDecisions(plan)
    const settled = plan.decisions.filter((d) => d.state === 'applied' || d.state === 'withdrawn')
    if (pending.length === 0) section.append(note(settled.length > 0 ? 'Every decision is settled.' : 'The mapping found nothing in the way.'))
    else {
      const current = pending.find((d) => this.shown !== undefined && same(d.title, this.shown)) ?? pending.find((d) => d.state === 'open') ?? pending[0]!
      const index = pending.indexOf(current)
      section.append(this.wizardHeader(pending, index), this.decisionCard(current, plan))
    }
    if (settled.length > 0) {
      const history = document.createElement('details')
      history.className = 'history'
      const applied = settled.filter((d) => d.state === 'applied').length
      const withdrawn = settled.length - applied
      const summary = document.createElement('summary')
      summary.textContent = [applied > 0 ? `${applied} applied` : '', withdrawn > 0 ? `${withdrawn} withdrawn` : ''].filter(Boolean).join(', ')
      history.append(summary)
      for (const decision of settled) history.append(this.settledDecision(decision))
      section.append(history)
    }
    return section
  }

  /** Where the wizard stands, with a step back and forward through the pending decisions. */
  private wizardHeader(pending: Decision[], index: number): HTMLElement {
    const head = el('header', 'wizard')
    const open = pending.filter((d) => d.state === 'open').length
    head.append(el('span', 'count', `Decision ${index + 1} of ${pending.length}`), el('span', 'left', open === 0 ? 'all ruled' : `${open} to rule on`))
    const nav = el('span', 'nav')
    const previous = button('Previous', () => this.show(pending[index - 1]!))
    previous.disabled = index === 0
    const next = button('Next', () => this.show(pending[index + 1]!))
    next.disabled = index === pending.length - 1
    nav.append(previous, next)
    head.append(nav)
    return head
  }

  private show(decision: Decision): void {
    this.shown = decision.title
    this.editor = undefined
    this.draw()
  }

  /** A decision to make: what the code and the spec disagree on, and the ways to settle it, each a button. */
  private decisionCard(decision: Decision, plan: PlanState): HTMLElement {
    const rulable = plan.commentable
    const card = el('article', `decision ${decision.state}${rulable && decision.state === 'open' && decision.proposals.length > 0 ? ' attention' : ''}`)
    const head = el('header', 'head')
    head.append(el('h3', 'title', decision.title))
    if (decision.state !== 'open') head.append(el('span', `badge state ${decision.state}`, DECISION_STATE[decision.state]))
    card.append(head, this.sides(decision, plan))
    if (decision.proposals.length === 0 && decision.state === 'open') card.append(el('div', 'awaiting', 'waiting for the planner to propose'))
    if (decision.ruling) card.append(labelled('ruling', 'ruling', rulingText(decision)))
    if (rulable && this.editor?.kind === 'ruling' && same(this.editor.target, decision.title)) card.append(this.editorBox(this.editor))
    else if (rulable) card.append(this.rulingOptions(decision, plan))
    return card
  }

  /**
   * The two sides of the disagreement, side by side: the rules as the spec
   * has them, so the contract is read here rather than on the other tab, and
   * what the code does today.
   */
  private sides(decision: Decision, plan: PlanState): HTMLElement {
    const sides = el('div', 'sides')
    if (decision.on.length > 0) {
      const block = el('div', 'spec side')
      block.append(el('span', 'kind', 'the spec'))
      const rules = el('span', 'text')
      for (const name of decision.on) rules.append(this.specRule(name, plan))
      block.append(rules)
      sides.append(block)
    }
    sides.append(labelled('finding side', 'the code', decision.finding))
    return sides
  }

  /** A rule the decision is on, as the spec has it; the name stays the link to its row. */
  private specRule(name: string, plan: PlanState): HTMLElement {
    const row = el('div', 'rule')
    const link = this.itemLink(name)
    link.classList.add('name')
    link.title = `Concerns the rule "${name}"; opens it on the Spec tab.`
    row.append(link)
    const item = plan.spec ? itemNamed(plan.spec, name) : undefined
    if (!item) return row
    const text = el('span', 'text')
    renderMarkdownInline(item.text.replace(MARKER, '').trim(), text)
    row.append(': ', text)
    return row
  }

  /** Writes the ruling and moves the wizard on to the next open decision, the one after this first; stays when none is left. */
  private rule(title: string, ruling: string): void {
    const pending = this.plan ? pendingDecisions(this.plan) : []
    const index = pending.findIndex((d) => same(d.title, title))
    const after = pending.slice(index + 1).find((d) => d.state === 'open') ?? pending.find((d, i) => d.state === 'open' && i !== index)
    this.shown = after?.title ?? title
    this.act({ type: 'rule_decision', decision: title, ruling })
  }

  /** A decision that is history: the finding and what was ruled, the title beneath as the reference. */
  private settledDecision(decision: Decision): HTMLElement {
    const row = el('div', `decision settled ${decision.state}`)
    row.append(labelled('finding', 'the code', decision.finding))
    if (decision.state === 'withdrawn') row.append(el('div', 'awaiting', 'withdrawn: the mapping found it no longer holds'))
    else if (decision.ruling) row.append(labelled('ruling', 'ruled', rulingText(decision)))
    const foot = el('div', 'foot')
    foot.append(el('span', 'title', decision.title))
    if (decision.on.length > 0) foot.append(el('span', 'on', `on ${decision.on.join(', ')}`))
    row.append(foot)
    return row
  }

  /**
   * The ways to settle a decision: change the spec one of the proposed ways,
   * keep it and change the code, or say it in the user's own words. The
   * chosen one is marked; a pick writes the ruling and moves the wizard on
   * to the next open decision. Nothing is sent until Send rulings.
   */
  private rulingOptions(decision: Decision, plan: PlanState): HTMLElement {
    const wrap = el('div', 'options')
    const pick = (ruling: string) => this.rule(decision.title, ruling)
    const chosen = (ruling: string) => decision.ruling !== undefined && same(decision.ruling, ruling)
    const sent = 'Send rulings from the plan bar hands them to the planner; nothing is sent now.'
    if (decision.state === 'open' && decision.proposals.length > 0) {
      wrap.append(el('p', 'lead', 'Pick one: the spec then reads as chosen and the code is built to it. Nothing is sent until Send rulings.'))
    }
    for (const proposal of decision.proposals) {
      const option = button('', () => pick(proposal), { title: `Rule that the rule reads so. ${sent}` })
      option.className = `option change${chosen(proposal) ? ' chosen' : ''}`
      const rewritten = rewrittenRule(proposal, decision, plan)
      option.append(el('span', 'kind', 'Change the spec'))
      // The rule is named above; repeating its lead-in on every option buries the sentence that differs.
      if (rewritten && decision.on.length > 1) option.append(el('span', 'rule', rewritten.name))
      const text = el('span', 'text')
      renderMarkdownInline(rewritten?.text ?? proposal, text)
      option.append(text)
      wrap.append(option)
    }
    const keep = button('', () => pick(KEEP_RULING), { title: `The rule stands as written; the code is changed to match. ${sent}` })
    keep.className = `option keep${chosen(KEEP_RULING) ? ' chosen' : ''}`
    keep.append(el('span', 'kind', 'Keep the spec'), el('span', 'text', 'the code changes'))
    wrap.append(keep)
    const ownRuling = decision.ruling !== undefined && !chosen(KEEP_RULING) && !decision.proposals.some((p) => chosen(p))
    const own = button('', () => this.openEditor({ kind: 'ruling', target: decision.title, text: ownRuling ? decision.ruling! : '' }), {
      title: `Write the ruling in your own words. ${sent}`,
    })
    own.className = `option own${ownRuling ? ' chosen' : ''}`
    const ownText = el('span', 'text')
    if (ownRuling) renderMarkdownInline(decision.ruling!, ownText)
    else ownText.textContent = 'say what should happen'
    own.append(el('span', 'kind', 'Own ruling'), ownText)
    wrap.append(own)
    return wrap
  }

  // --- the task board ---------------------------------------------------------

  /** Tasks as the board groups them: under the heading the mapping put them, in file order. */
  private tasksSection(plan: PlanState): HTMLElement {
    const section = el('section', 'tasks')
    const heading = el('h2', 'heading', 'Tasks')
    heading.title = plan.tasksPath
    section.append(heading)
    const groups: { title: string; tasks: Task[] }[] = []
    for (const task of plan.tasks) {
      const title = task.group ?? ''
      const last = groups.at(-1)
      if (last && last.title === title) last.tasks.push(task)
      else groups.push({ title, tasks: [task] })
    }
    for (const group of groups) section.append(this.taskGroup(group.title, group.tasks, plan))
    const record = plan.lastVerification
    if (record) {
      const line = el('p', `verification ${record.ok ? 'ok' : 'failed'}`)
      line.append(el('span', 'kind', record.ok ? 'tests passed' : 'tests failed'), el('span', 'text', `${record.text} (${record.at})`))
      section.append(line)
    }
    return section
  }

  private taskGroup(title: string, tasks: Task[], plan: PlanState): HTMLElement {
    const group = el('div', 'group')
    if (title) group.append(el('h3', 'heading', title))
    const list = el('ul', 'board')
    for (const task of tasks) list.append(this.taskRow(task, plan))
    group.append(list)
    return group
  }

  /**
   * What the person wants of a task: its name, where it stands and the files
   * it touches. The mapper's text, context and `how:` are for the implementer
   * and stay in the file; the heading is the link to it.
   */
  private taskRow(task: Task, plan: PlanState): HTMLElement {
    const started = plan.stage !== 'mapped'
    const row = el('li', `task ${task.state}${task.removed ? ' removed' : ''}`)
    const line = el('div', 'line')
    line.append(named(task.name, ''))
    if (task.removed) line.append(el('span', 'badge removed', 'removed'))
    else if (started) {
      line.append(el('span', `badge state ${task.state}`, blockedReason(task) ?? TASK_STATE[task.state]))
      const unproven = task.state === 'tested' ? task.delivers.filter((d) => !task.proves.some((p) => same(p.item, d))) : []
      if (unproven.length > 0) line.append(el('span', 'badge gap', `no test for ${unproven.join(', ')}`))
    }
    row.append(line)
    if (task.files.length > 0) {
      const files = el('ul', 'files')
      for (const file of task.files) {
        const item = el('li', 'file')
        item.append(fileLink(file, file))
        files.append(item)
      }
      row.append(files)
    }
    return row
  }

  // --- comments ---------------------------------------------------------------

  /** The comments on a target and, when one is being written for it, the editor. */
  private attachments(plan: PlanState, target: string): HTMLElement[] {
    const nodes: HTMLElement[] = []
    const comments = commentsOn(plan.review, target)
    if (comments.length > 0) {
      const list = el('ul', 'comments')
      for (const placed of comments) list.append(this.commentRow(placed, plan, false))
      nodes.push(list)
    }
    const editor = this.editor
    if (editor?.kind === 'comment' && same(editor.target, target) && !editor.comment) nodes.push(this.editorBox(editor))
    return nodes
  }

  /** A comment as written, its answer beneath it; `linked` names the rule it is on, for the review tab where the rule is not in sight. */
  private commentRow({ ref, comment, pending }: PlacedComment, plan: PlanState, linked: boolean): HTMLElement {
    const awaitsReader = comment.resolution !== undefined && !comment.closed
    const row = el('li', `comment${comment.closed ? ' closed' : ' open'}${awaitsReader ? ' attention' : ''}`)
    const editor = this.editor
    if (editor?.kind === 'comment' && editor.comment && sameRef(editor.comment, ref)) {
      row.append(this.editorBox(editor))
      return row
    }
    if (linked) {
      const on = el('div', 'on')
      on.append(el('span', 'label', 'on '), this.itemLink(comment.target))
      row.append(on)
    }
    const head = el('div', 'line')
    head.append(el('span', 'text', comment.text))
    if (pending && plan.commentable) {
      const controls = el('span', 'controls')
      controls.append(
        button('Edit', () => this.openEditor({ kind: 'comment', target: comment.target, comment: ref, text: comment.text })),
        button('Remove', () => this.act({ type: 'remove_comment', comment: ref })),
      )
      head.append(controls)
    }
    row.append(head)
    if (comment.resolution) {
      const resolution = el('div', `resolution ${comment.resolution.kind}`)
      resolution.append(el('span', 'kind', comment.resolution.kind), el('span', 'text', comment.resolution.text))
      if (!comment.closed) {
        resolution.append(
          button('Resolve', () => this.act({ type: 'resolve_comment', comment: ref }), {
            title:
              comment.resolution.kind === 'disagreed'
                ? 'Close this comment although the agent disagreed with it.'
                : 'Close this comment.',
          }),
        )
      }
      row.append(resolution)
    } else if (!pending) row.append(el('div', 'awaiting', 'waiting for the agent to resolve this'))
    return row
  }

  private editorBox(editor: Editor): HTMLElement {
    const box = el('div', 'editor')
    const area = document.createElement('textarea')
    area.value = editor.text
    area.rows = 3
    area.placeholder = editor.kind === 'ruling' ? 'What should happen instead?' : 'What is wrong with it?'
    area.addEventListener('input', () => (editor.text = area.value))
    const label = editor.kind === 'ruling' ? 'Rule' : editor.comment ? 'Save' : 'Add comment'
    const save = button(label, () => {
      const text = area.value.trim()
      if (!text) return
      this.editor = undefined
      if (editor.kind === 'ruling') this.rule(editor.target, text)
      else if (editor.comment) this.act({ type: 'edit_comment', comment: editor.comment, text })
      else this.act({ type: 'add_comment', target: editor.target, text })
      this.draw()
    })
    box.append(area, save, button('Cancel', () => this.openEditor(undefined)))
    queueMicrotask(() => area.focus())
    return box
  }
}

function pendingRound(review: Review) {
  const last = review.rounds.at(-1)
  return last && last.submittedAt === undefined ? last : undefined
}

/** Decisions still in play: open, or ruled and with the planner. */
function pendingDecisions(plan: PlanState): Decision[] {
  return plan.decisions.filter((d) => d.state === 'open' || d.state === 'ruled')
}

/** The ruling as the reader should see it: `keep` says what it means, anything else is the text as written. */
/**
 * The rule, edge case or question of that name; undefined once the spec no
 * longer has it. Here rather than in the spec model, which the webview cannot
 * import: it reads files.
 */
function itemNamed(spec: Spec, name: string): Item | undefined {
  for (const scenario of spec.scenarios) {
    for (const behaviour of scenario.behaviours) {
      if (same(behaviour.name, name)) return behaviour
      const edge = behaviour.edges.find((e) => same(e.name, name))
      if (edge) return edge
    }
  }
  return spec.questions.find((q) => same(q.name, name))
}

/** A proposal is a rule's new text, written with the `**Name**:` lead-in the spec line has; the card names the rule itself. */
function rewrittenRule(proposal: string, decision: Decision, plan: PlanState): { name: string; text: string } | undefined {
  const lead = /^\*\*([^*]+?)\*\*\s*:?\s*([\s\S]*)$/.exec(proposal.trim())
  if (!lead) return undefined
  const name = lead[1]!.trim().replace(/:$/, '').trim()
  const known = decision.on.some((n) => same(n, name)) || (plan.spec !== undefined && itemNamed(plan.spec, name) !== undefined)
  return known ? { name, text: lead[2]!.trim() } : undefined
}

function rulingText(decision: Decision): string {
  return decision.ruling !== undefined && same(decision.ruling, KEEP_RULING) ? 'keep the spec; the code changes' : (decision.ruling ?? '')
}

function struckItems(review: Review): string[] {
  return review.rounds.flatMap((r) => r.strikes)
}

/** Every comment on a target with where it sits, since the file gives a comment no id of its own. */
function commentsOn(review: Review, target: string): PlacedComment[] {
  const placed: PlacedComment[] = []
  for (const round of review.rounds) {
    round.comments.forEach((comment, index) => {
      if (same(comment.target, target)) placed.push({ ref: { round: round.number, index }, comment, pending: round.submittedAt === undefined })
    })
  }
  return placed
}

const sameRef = (a: CommentRef, b: CommentRef): boolean => a.round === b.round && a.index === b.index

function el(tag: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(tag)
  node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

/** `Name: text`, the name as the lead-in it is in the file. */
function named(name: string, text: string): HTMLElement {
  const span = el('span', 'text')
  span.append(el('strong', 'name', name), text ? `: ${text}` : '')
  return span
}

/** A labelled line: what the mapper found, what the user ruled. The text is one line of markdown, as the file has it. */
function labelled(className: string, kind: string, text: string): HTMLElement {
  const line = el('div', className)
  const body = el('span', 'text')
  renderMarkdownInline(text, body)
  line.append(el('span', 'kind', kind), body)
  return line
}

function note(text: string): HTMLElement {
  return el('p', 'note', text)
}

/** The re-map waits for the rulings to be applied: a board mapped under a pending decision would go stale on the revision. */
function staleNote(pendingDecisions: string[]): string {
  if (pendingDecisions.length === 0) return 'The tasks predate the last change to the spec; they are re-mapped when the plan session’s turn ends.'
  return `The tasks predate the last change to the spec; they are re-mapped once ${pendingDecisions.map((t) => `"${t}"`).join(', ')} ${pendingDecisions.length === 1 ? 'is' : 'are'} ruled on and applied.`
}

/** `[blocked: reason]` as written; the reason is what the badge should say. */
function blockedReason(task: Task): string | undefined {
  const match = /\[blocked\s*:?\s*([^\]]*)\]/i.exec(task.text)
  if (!match) return undefined
  const reason = match[1]!.trim()
  return reason ? `blocked: ${reason}` : 'blocked'
}

function fileLink(path: string, label: string): HTMLButtonElement {
  const link = button(label, () => post({ type: 'open_file', path }))
  link.className = 'link file'
  link.title = `Open ${path}`
  return link
}

function button(label: string, onClick: () => void, options: { title?: string } = {}): HTMLButtonElement {
  const node = document.createElement('button')
  node.type = 'button'
  node.textContent = label
  if (options.title) node.title = options.title
  node.addEventListener('click', onClick)
  return node
}

customElements.define('plan-view', PlanView)
