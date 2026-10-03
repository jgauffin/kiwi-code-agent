import * as vscode from 'vscode'
import type { SessionEvent } from '../agent/session/code-session'
import type { ModelProfile, Step } from '../agent/session/model-profile'
import type { SessionManager, SessionRecord } from '../agent/session/session-manager'
import { buildRepoMap } from '../agent/repo-map/build-map'
import { finishDocsMap, planDocsMap, readDocsSummary, startDocsMap, type DocsMapResult } from '../agent/docs-map/build'
import { docsMapKickoff } from '../agent/phases/docs-map'
import { progressLine } from '../agent/phases/reconcile'
import { sharedBuild } from '../agent/session/generated-context'
import { errorMessage } from '../error-message'

export type DocsMapRunnerDeps = {
  workspaceRoot: string
  sessions: SessionManager
  /** What a step runs on. */
  profileFor: (step: Step, attempt?: number) => ModelProfile
  /** The build's record is nobody's to return to; its status is dropped with it. */
  forgetStatus: (sessionId: string) => void
}

/**
 * The repo map and the docs map, both mechanical builds the extension runs
 * for the user: the repo map in the extension host, the docs map through a
 * session that reads the changed docs.
 */
export class DocsMapRunner {
  /** The docs map build in flight: the run's session, where its progress goes, and the turn its caller waits on. */
  private active: { sessionId: string; progress: (line: string) => void; done: (errors: string[]) => void } | undefined

  constructor(private readonly deps: DocsMapRunnerDeps) {}

  /**
   * The `Kiwipow Agent: Build Repo Map` command. The build is mechanical and runs
   * in the extension host: no engine is started, so nothing is spent and
   * nothing is asked of the user while it runs.
   */
  async buildRepoMapCommand(): Promise<void> {
    try {
      const result = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Kiwipow Agent: building the repo map' },
        (progress) => buildRepoMap(this.deps.workspaceRoot, (line) => progress.report({ message: line })),
      )
      const count = result.projects.length
      void vscode.window.showInformationMessage(`Kiwipow Agent: repo map built — ${count} project${count === 1 ? '' : 's'}.`)
    } catch (error) {
      void vscode.window.showWarningMessage(`Kiwipow Agent: the repo map could not be built: ${errorMessage(error)}`)
    }
  }

  /**
   * The `Kiwipow Agent: Build Docs Map` command. Unlike the repo map this one
   * spends a turn, so it says up front how many docs it has to read and
   * nothing at all when the map is already current.
   */
  async buildDocsMapCommand(ignored: string[]): Promise<void> {
    const plan = await planDocsMap(this.deps.workspaceRoot, ignored)
    if (plan.current && (await this.isComposed())) {
      void vscode.window.showInformationMessage('Kiwipow Agent: the docs map is current.')
      return
    }
    try {
      const result = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Kiwipow Agent: building the docs map' },
        (progress) => this.build(ignored, (line) => progress.report({ message: line })),
      )
      const described = result.described.length
      const left = result.undescribed.length
      const tail = left === 0 ? '' : `, ${left} still to describe`
      void vscode.window.showInformationMessage(`Kiwipow Agent: docs map built: ${described} doc${described === 1 ? '' : 's'}${tail}.`)
    } catch (error) {
      void vscode.window.showWarningMessage(`Kiwipow Agent: the docs map could not be built: ${errorMessage(error)}`)
    }
  }

  /**
   * Describes the docs that changed and composes the map. Two callers asking
   * at once (a session start and the command, or two starts) share the one
   * build rather than spending the turn twice.
   */
  build(ignored: string[], onProgress: (line: string) => void = () => {}): Promise<DocsMapResult> {
    return sharedBuild(`docs-map:${this.deps.workspaceRoot}`, () => this.runDocsMap(ignored, onProgress))
  }

  private async runDocsMap(ignored: string[], onProgress: (line: string) => void): Promise<DocsMapResult> {
    const plan = await startDocsMap(this.deps.workspaceRoot, ignored)
    if (plan.changed.length > 0) await this.describeDocs(plan.changed, onProgress)
    onProgress('Composing the map…')
    // Composed whatever the run did: what it wrote is kept, what it did not is the next build's work.
    return finishDocsMap(this.deps.workspaceRoot, ignored)
  }

  /** One run for the whole build: it reads the changed docs, writes an entry each, and is gone when its turn ends. */
  private async describeDocs(docs: string[], onProgress: (line: string) => void): Promise<void> {
    const { sessions, profileFor } = this.deps
    // The docs it was handed are its whole read scope: an unchanged doc costs nothing, and the code is out of reach.
    const record = await sessions.create(profileFor('docs-map'), 'docs-map', undefined, { files: docs })
    const finished = new Promise<string[]>((resolve) => {
      this.active = { sessionId: record.id, progress: onProgress, done: resolve }
    })
    let errors: string[]
    try {
      onProgress(`Describing ${docs.length} doc${docs.length === 1 ? '' : 's'}…`)
      await sessions.send(record.id, docsMapKickoff(docs), `Describing ${docs.length} doc${docs.length === 1 ? '' : 's'}`)
      errors = await finished
    } finally {
      this.active = undefined
      // The record is the build's, not a session anyone returns to; the run log stays for inspection.
      await sessions.remove(record.id)
      this.deps.forgetStatus(record.id)
    }
    if (errors.length > 0) throw new Error(errors.join('; '))
  }

  /** A build run has no transcript in the UI: its events are the progress line the caller shows. */
  follow(record: SessionRecord, event: SessionEvent): void {
    const run = this.active
    if (!run || run.sessionId !== record.id) return
    if (event.type === 'turn_done') {
      run.done(event.isError ? (event.errors.length > 0 ? event.errors : ['the run ended with an error']) : [])
      return
    }
    if (event.type === 'error' && event.fatal) {
      run.done([event.message])
      return
    }
    // An engine that died without finishing a turn still ends the build: a wait nobody
    // resolves would be joined by every later build and never come back.
    if (event.type === 'ended') {
      run.done(['the run ended before it finished'])
      return
    }
    const line = progressLine(event, 'Docs map')
    if (line !== undefined) run.progress(line)
  }

  private async isComposed(): Promise<boolean> {
    return (await readDocsSummary(this.deps.workspaceRoot)) !== undefined
  }
}
