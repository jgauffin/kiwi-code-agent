import type { SessionEvent } from '../agent/session/code-session'
import { decisionsHandoffPrompt, specPath } from '../agent/phases/blind-plan'
import { decisionsPath, openDecisions, pendingDecisions, readDecisions } from '../agent/phases/decisions'
import { progressLine, reconcileKickoff } from '../agent/phases/reconcile'
import { readSpecState } from '../agent/phases/spec-file'
import type { ModelProfile, Step } from '../agent/session/model-profile'
import type { SessionManager, SessionRecord } from '../agent/session/session-manager'
import type { RunState } from './protocol'

export type PlanChecksDeps = {
  workspaceRoot: string
  sessions: SessionManager
  /** What a step runs on. */
  profileFor: (step: Step, attempt?: number) => ModelProfile
  sendState: () => Promise<void>
  changed: () => void
  /** Nothing stands between the approved spec and the code once the check comes back clean. */
  onClean: (plan: SessionRecord) => Promise<void>
}

/** The check of a feature's plan against the code: one run under the plan session, the line the plan bar shows for it, and what it leaves in the decisions file. */
export class PlanChecks {
  /** The check against the code under each plan session, by the plan session's id: the current step, or how the last run ended. */
  private readonly checks = new Map<string, RunState>()

  constructor(private readonly deps: PlanChecksDeps) {}

  checkOf(sessionId: string): RunState | undefined {
    return this.checks.get(sessionId)
  }

  /** A check has no transcript in the UI: its events become the one line the plan bar shows. */
  followCheck(child: SessionRecord, event: SessionEvent): void {
    const parentId = child.parentId!
    const check = this.checks.get(parentId)
    if (!check?.live) return
    if (event.type === 'turn_done') {
      void this.finishCheck(child, event.isError ? (event.errors.length > 0 ? event.errors : ['the run ended with an error']) : [])
      return
    }
    if (event.type === 'error' && event.fatal) {
      void this.finishCheck(child, [event.message])
      return
    }
    const line = progressLine(event)
    if (line === undefined || line === check.text) return
    this.checks.set(parentId, { live: true, text: line })
    void this.deps.sendState()
  }

  /**
   * Checks the plan session's approved spec against the code as a run under
   * it; nothing happens while one is live. A re-check continues the last
   * check's conversation where the engine resumes, so the code it read is not
   * read again.
   */
  async startCheck(record: SessionRecord): Promise<void> {
    const { sessions, workspaceRoot, profileFor } = this.deps
    if (record.mode !== 'plan' || !record.feature || sessions.liveChildOf(record.id)) return
    const spec = await readSpecState(specPath(workspaceRoot, record.feature))
    if (!spec.exists || spec.status !== 'approved') return
    const previous = sessions.latest('reconcile', record.feature)
    const child = await sessions.create(profileFor('reconcile'), 'reconcile', record.feature, { parentId: record.id, continues: previous })
    this.checks.set(record.id, { live: true, text: 'Checking the spec against the code…' })
    await this.deps.sendState()
    await sessions.send(child.id, reconcileKickoff(child.engineSessionId !== undefined), 'Checking the spec against the code')
  }

  async stopCheck(record: SessionRecord | undefined): Promise<void> {
    const { sessions } = this.deps
    // Task runs and cleanups live under the same tab; only the check is this button's to stop.
    const child = record ? sessions.list().find((r) => r.parentId === record.id && r.mode === 'reconcile' && sessions.isLive(r.id)) : undefined
    if (!record || !child) return
    this.checks.set(record.id, { live: false, text: 'Check stopped' })
    await sessions.close(child.id)
    await this.deps.sendState()
    this.deps.changed()
  }

  /**
   * The run is over: stop its engine and read what it left in the decisions
   * file. Decisions without a proposal go to the planner to propose on. With
   * nothing pending the board is derived from the spec and the build goes on.
   */
  private async finishCheck(child: SessionRecord, errors: string[]): Promise<void> {
    const { sessions, workspaceRoot } = this.deps
    const parentId = child.parentId!
    // Marked over before the first await, so a late event from the dying engine cannot finish it twice.
    this.checks.set(parentId, { live: false, text: this.checks.get(parentId)?.text ?? '' })
    await sessions.close(child.id)
    let clean = false
    let text: string
    const feature = child.feature!
    if (errors.length > 0) {
      text = `Check failed: ${errors.join('; ')}`
    } else {
      const decisions = await readDecisions(decisionsPath(workspaceRoot, feature))
      const open = openDecisions(decisions)
      clean = pendingDecisions(decisions).length === 0
      text = `Checked: ${open.length === 0 ? 'the code is clear' : `${open.length} decision${open.length === 1 ? '' : 's'}`}`
      const unproposed = open.filter((d) => d.proposals.length === 0).map((d) => d.title)
      if (unproposed.length > 0 && sessions.get(parentId)) {
        await sessions.send(parentId, decisionsHandoffPrompt(feature, unproposed), `${unproposed.length} open decision${unproposed.length === 1 ? '' : 's'} handed over`)
      }
    }
    this.checks.set(parentId, { live: false, text })
    await this.deps.sendState()
    this.deps.changed()
    const plan = sessions.get(parentId)
    if (clean && plan) await this.deps.onClean(plan)
  }
}
