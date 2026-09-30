import type { SessionRecord } from '../agent/session/session-manager'
import type { SessionEvent } from '../agent/session/code-session'
import type { ModelProfile, Step } from '../agent/session/model-profile'
import type { SessionStatus } from '../agent/session/session-status'
import { specPath } from '../agent/phases/blind-plan'
import { decisionsPath, readDecisions } from '../agent/phases/decisions'
import { contextPath, readScenarioContext } from '../agent/phases/scenario-context'
import { TASK_CARRY_ON, fixKickoff, implementationStarts, taskKickoff, taskSettled } from '../agent/phases/implement'
import { tasksStale } from '../agent/phases/plan-stage'
import { readSpecState } from '../agent/phases/spec-file'
import { parseSpec } from '../agent/phases/spec-model'
import { changeBoard, deriveBoard, nextTask, readBoard, readTasks, recordVerification, sameName, tasksPath, updateTask, writeBoard } from '../agent/phases/tasks-file'
import {
  countsAgainstBudget,
  describeCommand,
  runVerification,
  verificationDue,
  type Attribute,
  type HeldFailure,
  type VerificationFailure,
} from '../agent/phases/verification'
import type { ChatRefresh, Notify, RunSessions, SessionSwitch, Verifier } from './feature-runs'
import type { RunState } from './protocol'

/** What the build tells the step after it: a test run is about to start, and one has passed. */
export interface BuildListener {
  runStarting(feature: string): void
  passed(feature: string): Promise<void>
}

export type BuildDeps = {
  workspaceRoot: string
  sessions: RunSessions
  /** What a step runs on. `attempt` counts the fixes of a failed test run. */
  profileFor: (step: Step, attempt?: number) => ModelProfile
  verifier: Verifier
  /** Tells a failing test's own feature from another hand's. */
  attribute: (feature: string) => Attribute
  allowWrites: SessionSwitch
  statusOf: (sessionId: string) => SessionStatus
  isOpen: (sessionId: string) => boolean
  refresh: ChatRefresh
  notify: Notify
  listener: BuildListener
}

/**
 * A feature's build once its spec is approved: one implementer run per task
 * under the plan's tab, then the test run over the board, with a failed run
 * handed back to an implementer up to the failure budget.
 */
export class FeatureBuild {
  /** The test run per feature: what it is doing, or how the last one ended. */
  private readonly verifications = new Map<string, RunState>()
  /** Consecutive failed test runs per feature; a pass or a manual run resets it. */
  private readonly verifyFailures = new Map<string, number>()

  constructor(private readonly deps: BuildDeps) {}

  /** The test run's line on the plan bar. */
  lineOf(feature: string): RunState | undefined {
    return this.verifications.get(feature)
  }

  /**
   * Runs the test commands over the tasks' files, records the outcome, and
   * hands a failure to the implementer, up to the budget of consecutive
   * failures; past it the failed record waits for the user. A manual run
   * starts the count over. True when the tests passed.
   */
  async verify(feature: string, manual: boolean): Promise<boolean> {
    const { workspaceRoot, verifier, refresh } = this.deps
    if (this.verifications.get(feature)?.live) return false
    if (manual) this.verifyFailures.delete(feature)
    this.deps.listener.runStarting(feature)
    this.verifications.set(feature, { live: true, text: 'Running the tests…' })
    await refresh.sendState()
    let text: string
    let passed = false
    let held: HeldFailure[] = []
    try {
      const outcome = await runVerification({
        cwd: workspaceRoot,
        feature,
        rules: verifier.rules(),
        run: verifier.run,
        attribute: this.deps.attribute(feature),
        retry: { seconds: verifier.retrySeconds(), wait: (ms) => new Promise((r) => setTimeout(r, ms)) },
        onStart: (command) => {
          this.verifications.set(feature, { live: true, text: `Running ${describeCommand(command, workspaceRoot)}` })
          void refresh.sendState()
        },
      })
      held = outcome.held
      if (outcome.record.ok) {
        this.verifyFailures.delete(feature)
        text = `Tests passed: ${outcome.record.text}`
        passed = true
      } else if (!countsAgainstBudget(outcome)) {
        // All foreign on the retry too (`Held rather than verified`): stays in verification, spared from the budget, and asked about below.
        text = `Tests failed on files another hand changed: ${outcome.record.text}`
      } else {
        const failures = (this.verifyFailures.get(feature) ?? 0) + 1
        this.verifyFailures.set(feature, failures)
        text = `Tests failed: ${outcome.record.text}`
        if (failures <= verifier.failureBudget()) await this.handToImplementer(feature, outcome.failures, failures)
        else text += ` (${failures} in a row; fix it and verify again)`
      }
    } catch (error) {
      text = `Test run failed: ${error instanceof Error ? error.message : String(error)}`
    }
    this.verifications.set(feature, { live: false, text })
    await refresh.sendState()
    refresh.changed()
    if (held.length > 0) await this.askAboutForeignFailures(feature, held)
    if (passed) await this.deps.listener.passed(feature)
    return passed
  }

  /**
   * An implementer's turn ended: a board left all tested without a passing
   * run gets the test run, whether the turn marked the last task or fixed the
   * code after a failed run. A board that already passed is left alone.
   */
  async followBoard(feature: string): Promise<void> {
    const tasks = await readTasks(tasksPath(this.deps.workspaceRoot, feature))
    if (verificationDue(tasks)) await this.verify(feature, false)
  }

  /**
   * An implementer's turn ended with the spec changed under the board: the
   * user's answer amended a rule. The board is derived again, keeping its
   * progress, without a check against the code: the run that amended the rule
   * has read that code already.
   */
  async followAmendment(feature: string): Promise<void> {
    const { workspaceRoot } = this.deps
    const spec = await readSpecState(specPath(workspaceRoot, feature))
    const path = tasksPath(workspaceRoot, feature)
    if (!spec.exists || !tasksStale(spec, await readTasks(path))) return
    const existing = await readBoard(path)
    if (!existing) return
    await writeBoard(path, deriveBoard(parseSpec(spec.body), existing, await readScenarioContext(contextPath(workspaceRoot, feature))))
    await this.deps.refresh.sendState()
  }

  /** The docs listing after approval has ended: the build starts on its own, so approving is the only act it takes. */
  async implementAfterApproval(record: SessionRecord): Promise<void> {
    const feature = record.feature!
    try {
      const spec = await readSpecState(specPath(this.deps.workspaceRoot, feature))
      const tasks = await readTasks(tasksPath(this.deps.workspaceRoot, feature))
      if (!implementationStarts(spec, tasks, this.implementerLive(feature))) return
      await this.startImplementing(record)
    } catch (error) {
      this.deps.notify.error(`cannot start the implementation: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /**
   * A build the last window cut off mid-turn goes on where it stood, once per
   * feature: a task run carries its task on, a run fixing a failed sweep hands
   * the board back to the sweep. A run stopped on the user keeps waiting.
   */
  async resumeCutOffBuilds(): Promise<void> {
    const { sessions } = this.deps
    const resumed = new Set<string>()
    for (const run of await sessions.takeCutOff()) {
      if (run.mode !== 'implement' || !run.feature || resumed.has(run.feature)) continue
      resumed.add(run.feature)
      const plan = (run.parentId ? sessions.get(run.parentId) : undefined) ?? sessions.latest('plan', run.feature)
      if (run.task !== undefined && plan) await this.implementAfterApproval(plan)
      else if (run.task === undefined) {
        await this.followBoard(run.feature).catch((error: unknown) => {
          this.deps.notify.error(`cannot resume the test run: ${error instanceof Error ? error.message : String(error)}`)
        })
      }
    }
  }

  /**
   * The next unfinished task gets a run of its own under the plan's tab,
   * started on the board's hand-off rather than on a conversation grown
   * through every task before it; the run that stopped on that task picks it
   * up again instead. With no task left the board goes to the test sweep.
   */
  async startImplementing(plan: SessionRecord): Promise<void> {
    const { workspaceRoot, sessions, allowWrites } = this.deps
    const feature = plan.feature!
    const path = tasksPath(workspaceRoot, feature)
    const board = await readBoard(path)
    const task = board ? nextTask(board) : undefined
    if (!board || !task) return this.followBoard(feature)
    const previous = sessions.list().find((r) => r.mode === 'implement' && r.feature === feature && r.task !== undefined && sameName(r.task, task.name))
    if (previous) {
      if (this.deps.statusOf(previous.id) === 'implementing') return
      // The switch does not outlive the window, and the approval that turned it on still stands.
      allowWrites.setEnabled(previous.id, true)
      await sessions.send(previous.id, TASK_CARRY_ON)
      return
    }
    const spec = await readSpecState(specPath(workspaceRoot, feature))
    if (!spec.exists) return
    // Started by the host, so the run's only board call is the one that records how the task ended.
    const profile = this.deps.profileFor('implement')
    const started = await changeBoard(path, (b) => updateTask(b, task.name, { state: 'in_progress' }))
    const run = await sessions.create(profile, 'implement', feature, { parentId: plan.id, task: task.name })
    allowWrites.setEnabled(run.id, true)
    await this.deps.refresh.sendState()
    const decisions = await readDecisions(decisionsPath(workspaceRoot, feature))
    await sessions.send(run.id, taskKickoff(started, task.name, parseSpec(spec.body), decisions))
  }

  /**
   * A task run's turn ended. Its task settled: the run is closed and the next
   * task's run starts. Not settled: the run waits for the user, who can carry
   * it on. A run that fixed a failed sweep is closed and hands the board back
   * to the sweep.
   */
  async followTask(record: SessionRecord, event: SessionEvent): Promise<void> {
    const { workspaceRoot, sessions } = this.deps
    // The run moves its task on the board; the plan view shows the board, so it follows.
    if (event.type === 'tool_result' && this.deps.isOpen(record.id)) void this.deps.refresh.sendState()
    if (event.type !== 'turn_done' || event.isError) return
    const feature = record.feature!
    await this.followAmendment(feature)
    if (record.task === undefined) {
      // A fix run is over once the board goes back to the test run; left open, it holds the plan's tab against the cleanup.
      if (!verificationDue(await readTasks(tasksPath(workspaceRoot, feature)))) return
      await sessions.settle(record.id)
      await this.verify(feature, false)
      return
    }
    const board = await readBoard(tasksPath(workspaceRoot, feature))
    if (!board || !taskSettled(board, record.task)) return
    await sessions.settle(record.id)
    const plan = sessions.get(record.parentId!)
    if (plan) await this.startImplementing(plan)
  }

  /** An implementer at work on the feature: nothing starts a second one. */
  private implementerLive(feature: string): boolean {
    const { sessions } = this.deps
    return sessions.list().some((r) => r.mode === 'implement' && r.feature === feature && sessions.isLive(r.id))
  }

  /**
   * A failed sweep goes to a run of its own under the plan's tab, started on
   * the failure and the tasks it names rather than on whichever task ran last.
   * `attempt` is how many sweeps in a row have failed: each one tries harder.
   */
  private async handToImplementer(feature: string, failures: VerificationFailure[], attempt: number): Promise<void> {
    const { workspaceRoot, sessions } = this.deps
    const board = await readBoard(tasksPath(workspaceRoot, feature))
    if (!board) return
    const plan = sessions.latest('plan', feature)
    const run = await sessions.create(this.deps.profileFor('fix', attempt), 'implement', feature, { ...(plan ? { parentId: plan.id } : {}), fixAttempt: attempt })
    this.deps.allowWrites.setEnabled(run.id, true)
    await this.deps.refresh.sendState()
    await sessions.send(run.id, fixKickoff(feature, board, failures, workspaceRoot))
  }

  /**
   * `Held rather than verified`: the run's failures were foreign both times
   * and are already recorded on the board, naming the files and the hand.
   * The user, not the budget, decides what happens to them: run the suites
   * again, hand them to the implementer as if they were the feature's own,
   * or accept the feature with them standing.
   */
  private async askAboutForeignFailures(feature: string, held: HeldFailure[]): Promise<void> {
    const { workspaceRoot, refresh } = this.deps
    const lines = held.map((h) => `${describeCommand(h, workspaceRoot)} — ${h.files.join(', ')}: ${h.hand}`)
    const pick = await this.deps.notify.ask(
      `verification for "${feature}" failed only on files another hand changed:\n${lines.join('\n')}`,
      'Run again',
      'Hand to implementer anyway',
      'Accept',
    )
    if (pick === 'Run again') await this.verify(feature, true)
    else if (pick === 'Hand to implementer anyway') await this.handToImplementer(feature, held, this.verifyFailures.get(feature) ?? 1)
    else if (pick === 'Accept') {
      await recordVerification(tasksPath(workspaceRoot, feature), {
        at: new Date().toISOString(),
        ok: true,
        text: `Accepted despite another hand: ${held.map((h) => describeCommand(h, workspaceRoot)).join('; ')}`,
      })
      this.verifications.set(feature, { live: false, text: 'Accepted with tests failing on files another hand changed.' })
      await refresh.sendState()
      refresh.changed()
      await this.deps.listener.passed(feature)
    }
  }
}
