import { isAbsolute, join, relative } from 'node:path'
import type { SessionRecord } from '../agent/session/session-manager'
import type { SessionEvent } from '../agent/session/code-session'
import type { ModelProfile, Step } from '../agent/session/model-profile'
import { anyLimit, oversizedFiles, sizeReport, type Oversized } from '../agent/cleanup/oversized'
import { editedFiles } from '../agent/edits/edited-files'
import { cleanupKickoff } from '../agent/phases/cleanup'
import { progressLine } from '../agent/phases/reconcile'
import { readTasks, recordCleanupDecision, tasksPath } from '../agent/phases/tasks-file'
import { advance, editedUnitFile, finished, measured, resumed, settled, startProgress, type CleanupProgress } from './cleanup-progress'
import type { BuildListener } from './feature-build'
import type { ChatRefresh, Notify, RunSessions, SizeLimits } from './feature-runs'
import type { CleanupSweep, CleanupUnit, RunState } from './protocol'
import { errorMessage } from '../error-message'

/** A test run as the cleanup waits on it: whether it passed, and its line. */
export type TestRun = { passed: boolean; text: string }

export type CleanupDeps = {
  workspaceRoot: string
  sessions: RunSessions
  profileFor: (step: Step) => ModelProfile
  sizeLimits: SizeLimits
  refresh: ChatRefresh
  notify: Notify
  /** The test run the cleanup ends in, since the run had no shell to prove its split with. */
  verify: (feature: string) => Promise<TestRun>
}

/** What the plan bar shows of a feature's cleanup. */
export type CleanupState = { cleanup?: RunState; cleanupSweep?: CleanupSweep; cleanupProgress?: CleanupProgress }

/**
 * A feature's cleanup after its tests pass: the files its implementers edited
 * are measured, what is over a limit is offered to the user, and a split they
 * ask for runs under the plan's tab and ends in another test run.
 */
export class FeatureCleanup implements BuildListener {
  /** The cleanup run per feature: what it is doing, or how the last one ended. */
  private readonly cleanups = new Map<string, RunState>()
  /** The cleanup run's split per feature, unit by unit, for the Cleanup tab; cleared with the cleanup line by a new test run. */
  private readonly cleanupProgress = new Map<string, CleanupProgress>()
  /** What the last size sweep found per feature: the offer the user rules on. Absent until one has run in this window. */
  private readonly sweeps = new Map<string, Oversized[]>()

  constructor(private readonly deps: CleanupDeps) {}

  stateOf(feature: string): CleanupState {
    const cleanup = this.cleanups.get(feature)
    const flagged = this.sweeps.get(feature)
    const progress = this.cleanupProgress.get(feature)
    return {
      ...(cleanup ? { cleanup } : {}),
      ...(flagged ? { cleanupSweep: { units: flagged.map((u) => this.cleanupUnit(u)) } } : {}),
      ...(progress ? { cleanupProgress: progress } : {}),
    }
  }

  /** A new test run makes the last cleanup's outcome old news; one still running folds this run into its own. */
  runStarting(feature: string): void {
    if (this.cleanups.get(feature)?.live) return
    this.cleanups.delete(feature)
    this.cleanupProgress.delete(feature)
  }

  passed(feature: string): Promise<void> {
    return this.sweep(feature)
  }

  /**
   * The tests passed: the files the feature's implementers edited are
   * measured. Nothing is split on this alone. What is over a limit is an
   * offer the user rules on at the Cleanup step, since a split is a change to
   * code they have just seen proven.
   */
  async sweep(feature: string): Promise<void> {
    const { workspaceRoot, sessions, sizeLimits, refresh } = this.deps
    if (this.cleanups.get(feature)?.live) return
    const limits = sizeLimits.limits()
    // A sweep that cannot measure still settles the step: an offer never made would hold the Cleanup step open with nothing to act on.
    if (!anyLimit(limits)) return this.sizesUnchecked(feature, 'no size limits are set')
    const tasks = await readTasks(tasksPath(workspaceRoot, feature))
    // Skipped is the user's word that this feature is finished; done is the split already carried out.
    if (tasks.exists && (tasks.cleanup === 'skipped' || tasks.cleanup === 'done')) return
    const implementers = sessions.list().filter((r) => r.mode === 'implement' && r.feature === feature)
    if (implementers.length === 0) return this.sizesUnchecked(feature, 'no implementer session is left to say which files it edited')
    const files: string[] = []
    for (const record of implementers) {
      for (const file of editedFiles(await sessions.transcript(record.id))) if (!files.includes(file)) files.push(file)
    }
    const flagged = await oversizedFiles(workspaceRoot, files, limits, sizeLimits.ignore())
    this.sweeps.set(feature, flagged)
    if (flagged.length === 0) this.cleanups.set(feature, { live: false, text: 'Sizes checked: nothing to split' })
    await refresh.sendState()
    refresh.changed()
  }

  /** The user's word on the offer: split now, come back to it, or settle the feature as it stands. */
  async decide(feature: string, decision: 'run' | 'postpone' | 'skip', paths?: string[]): Promise<void> {
    if (decision === 'run') {
      await this.run(feature, paths)
      return
    }
    await recordCleanupDecision(tasksPath(this.deps.workspaceRoot, feature), decision === 'skip' ? 'skipped' : 'postponed')
    if (decision === 'skip') this.sweeps.delete(feature)
    await this.deps.refresh.sendState()
    this.deps.refresh.changed()
  }

  /** A cleanup run's events become the one line the plan bar shows and the split the Cleanup tab follows. */
  follow(child: SessionRecord, event: SessionEvent): void {
    const feature = child.feature!
    const cleanup = this.cleanups.get(feature)
    if (!cleanup?.live) return
    if (event.type === 'turn_done') {
      void this.finish(child, event.isError ? (event.errors.length > 0 ? event.errors : ['the run ended with an error']) : [])
      return
    }
    if (event.type === 'error' && event.fatal) {
      void this.finish(child, [event.message])
      return
    }
    const progressMoved = this.followProgress(feature, event)
    const line = progressLine(event, 'Cleanup')
    const lineMoved = line !== undefined && line !== cleanup.text
    if (lineMoved) this.cleanups.set(feature, { live: true, text: line })
    if (lineMoved || progressMoved) void this.deps.refresh.sendState()
  }

  /** Talking to a cleanup that has ended starts it splitting again, so its turn is followed and ends in the same measure and test run. */
  async reengage(run: SessionRecord): Promise<void> {
    const feature = run.feature
    if (!feature || this.cleanups.get(feature)?.live) return
    this.cleanups.set(feature, { live: true, text: 'answering…' })
    const progress = this.cleanupProgress.get(feature)
    if (progress) this.cleanupProgress.set(feature, resumed(progress))
    await this.deps.refresh.sendState()
  }

  /** The run shows on every tab of the feature, so it is found by the feature, not the active tab. */
  async stop(feature: string): Promise<void> {
    const { sessions, refresh } = this.deps
    const child = sessions.list().find((r) => r.mode === 'cleanup' && r.feature === feature && sessions.isLive(r.id))
    if (!child) return
    this.cleanups.set(feature, { live: false, text: 'Cleanup stopped' })
    const progress = this.cleanupProgress.get(feature)
    if (progress) this.cleanupProgress.set(feature, settled(progress, false, 'Cleanup stopped'))
    await sessions.close(child.id)
    await refresh.sendState()
    refresh.changed()
  }

  private async sizesUnchecked(feature: string, why: string): Promise<void> {
    this.sweeps.set(feature, [])
    this.cleanups.set(feature, { live: false, text: `Sizes not checked: ${why}` })
    await this.deps.refresh.sendState()
    this.deps.refresh.changed()
  }

  /**
   * The user asked for the split: the units the last sweep found, in the files
   * picked (all when none are named), go to a cleanup run under the plan's tab.
   * It starts on the size report and reads the files itself: the implementers
   * were one run per task, so none of them holds all of the feature's files.
   */
  private async run(feature: string, picked?: string[]): Promise<void> {
    const { workspaceRoot, sessions } = this.deps
    const refuse = (why: string) => this.deps.notify.warn(`cannot start the cleanup: ${why}`)
    if (this.cleanups.get(feature)?.live) return refuse('one is already running')
    const flagged = (this.sweeps.get(feature) ?? []).filter((u) => picked === undefined || picked.includes(this.workspaceRelative(u.path)))
    if (flagged.length === 0) return refuse('none of the picked files are in the last size sweep')
    const parent = sessions.latest('plan', feature) ?? sessions.list().find((r) => r.mode === 'implement' && r.feature === feature && !r.parentId)
    if (!parent) return refuse(`no plan session is left for "${feature}"`)
    const busy = sessions.liveChildOf(parent.id)
    if (busy) return refuse(`"${busy.title}" is still running under the plan; close it first`)
    const paths = [...new Set(flagged.map((u) => this.workspaceRelative(u.path)))]
    const child = await sessions.create(this.deps.profileFor('cleanup'), 'cleanup', feature, { parentId: parent.id, files: paths })
    this.cleanups.set(feature, { live: true, text: 'Splitting oversized units…' })
    this.cleanupProgress.set(feature, startProgress(flagged.map((u) => this.cleanupUnit(u))))
    await this.deps.refresh.sendState()
    await sessions.send(child.id, cleanupKickoff(sizeReport(workspaceRoot, flagged), false), `Splitting ${flagged.length} oversized unit${flagged.length === 1 ? '' : 's'}`)
  }

  /** True when the split moved; an edit on a flagged file has that file measured again. */
  private followProgress(feature: string, event: SessionEvent): boolean {
    const progress = this.cleanupProgress.get(feature)
    if (!progress) return false
    const toRelative = (path: string) => this.workspaceRelative(path)
    const next = advance(progress, event, toRelative)
    this.cleanupProgress.set(feature, next)
    const file = editedUnitFile(next, event, toRelative)
    if (file) {
      this.remeasure(feature, file).catch((error: unknown) => {
        this.deps.notify.warn(`cannot measure ${file} again: ${errorMessage(error)}`)
      })
    }
    return next !== progress
  }

  private async remeasure(feature: string, path: string): Promise<void> {
    const { workspaceRoot } = this.deps
    const over = await oversizedFiles(workspaceRoot, [join(workspaceRoot, path)], this.deps.sizeLimits.limits(), [])
    // Read after the measure: events that came in meanwhile moved the progress on.
    const progress = this.cleanupProgress.get(feature)
    if (!progress) return
    this.cleanupProgress.set(feature, measured(progress, path, over.map((u) => this.cleanupUnit(u))))
    await this.deps.refresh.sendState()
  }

  /**
   * The run is over: stop its engine, measure its files again, and run the
   * tests once more, since the run had no shell to prove its split with. The
   * line holds both outcomes.
   */
  private async finish(child: SessionRecord, errors: string[]): Promise<void> {
    const { workspaceRoot, refresh } = this.deps
    const feature = child.feature!
    // Marked over before the first await, so a late event from the dying engine cannot finish it twice.
    this.cleanups.set(feature, { live: false, text: this.cleanups.get(feature)?.text ?? '' })
    await this.deps.sessions.close(child.id)
    const progress = this.cleanupProgress.get(feature)
    if (errors.length > 0) {
      const text = `Cleanup failed: ${errors.join('; ')}`
      this.cleanups.set(feature, { live: false, text })
      if (progress) this.cleanupProgress.set(feature, settled(progress, false, text))
      await refresh.sendState()
      refresh.changed()
      return
    }
    const files = (child.files ?? []).map((f) => join(workspaceRoot, f))
    const left = await oversizedFiles(workspaceRoot, files, this.deps.sizeLimits.limits(), [])
    const split = left.length === 0 ? 'Cleaned: every unit is within its limits' : `Cleanup left ${left.length} unit${left.length === 1 ? '' : 's'} over a limit`
    // Written before the test run, whose pass sweeps again: the offer was answered, and what the split left is not a new one.
    await recordCleanupDecision(tasksPath(workspaceRoot, feature), 'done')
    this.sweeps.delete(feature)
    // Live through the test run: that keeps the run from clearing this line and its pass from sweeping again.
    this.cleanups.set(feature, { live: true, text: `${split}; running the tests…` })
    const measuredProgress = progress ? finished(progress, left.map((u) => this.cleanupUnit(u))) : undefined
    if (measuredProgress) this.cleanupProgress.set(feature, measuredProgress)
    await refresh.sendState()
    const tests = await this.deps.verify(feature)
    this.cleanups.set(feature, { live: false, text: `${split}; ${tests.text}` })
    if (measuredProgress) this.cleanupProgress.set(feature, settled(measuredProgress, tests.passed, tests.text))
    await refresh.sendState()
    refresh.changed()
  }

  /** A flagged unit as the plan view reads it. */
  private cleanupUnit(unit: Oversized): CleanupUnit {
    return {
      path: this.workspaceRelative(unit.path),
      line: unit.line,
      name: unit.name,
      kind: unit.kind,
      breaches: unit.breaches,
    }
  }

  /** A path as the plan view reads it: workspace-relative with forward slashes, so it links like every other path there. */
  private workspaceRelative(path: string): string {
    return (isAbsolute(path) ? relative(this.deps.workspaceRoot, path) : path).split('\\').join('/')
  }
}
