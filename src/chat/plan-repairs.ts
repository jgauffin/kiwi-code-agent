import * as vscode from 'vscode'
import { migrateSpecPrompt } from '../agent/phases/blind-plan'
import { migratePlan, type MigrationReport } from '../agent/phases/migrate-plan'
import { listPlans } from '../agent/phases/plan-list'
import type { SessionMode, SessionManager, SessionRecord } from '../agent/session/session-manager'
import type { ChatPanel } from './panel-registry'

export type PlanRepairsDeps = {
  workspaceRoot: string
  sessions: SessionManager
  newSession: (mode: SessionMode, feature?: string, prompt?: string, into?: ChatPanel, label?: string) => Promise<SessionRecord | undefined>
  sendState: () => Promise<void>
}

/** The mechanical repairs and migrations that keep a feature's plan files on contract. */
export class PlanRepairs {
  /** Features whose planner was handed the contract problems; its next finished turn completes the migration. */
  private readonly repairing = new Set<string>()

  constructor(private readonly deps: PlanRepairsDeps) {}

  /**
   * Brings one feature's plan files to the contract: the mechanical part now,
   * the rest through its planner, whose finished turn runs the mechanical
   * part again. Returns what was done and what is left.
   */
  async repairPlan(feature: string): Promise<MigrationReport> {
    const { workspaceRoot, sessions } = this.deps
    const report = await migratePlan(workspaceRoot, feature)
    if (report.problems.length > 0) {
      const prompt = migrateSpecPrompt(feature, report.problems)
      const live = sessions.list().find((r) => r.mode === 'plan' && r.feature === feature && sessions.isLive(r.id))
      this.repairing.add(feature)
      const label = 'Bringing the plan files to the contract'
      if (live) await sessions.send(live.id, prompt, label)
      else await this.deps.newSession('plan', feature, prompt, undefined, label)
    }
    await this.deps.sendState()
    return report
  }

  /** Every plan under `specs/`, the command's entry point; one summary at the end. */
  async migratePlans(): Promise<void> {
    const plans = await listPlans(this.deps.workspaceRoot)
    if (plans.length === 0) {
      void vscode.window.showInformationMessage('Kiwipow Agent: no plans to migrate.')
      return
    }
    const reports: MigrationReport[] = []
    for (const plan of plans) reports.push(await this.repairPlan(plan.feature))
    const handed = reports.filter((r) => r.problems.length > 0).map((r) => r.feature)
    const clean = reports.filter((r) => r.problems.length === 0).map((r) => r.feature)
    const parts = [
      clean.length > 0 ? `on contract: ${clean.join(', ')}` : '',
      handed.length > 0 ? `handed to the planner: ${handed.join(', ')}` : '',
    ].filter((p) => p.length > 0)
    void vscode.window.showInformationMessage(`Kiwipow Agent: migrated ${plans.length} plan${plans.length === 1 ? '' : 's'}; ${parts.join('; ')}.`)
  }

  /** `handed` says the planner has the remaining problems now; otherwise its turn is over and they are the user's to look at. */
  reportMigration(report: MigrationReport, handed: boolean): void {
    const left = report.problems.length
    if (left === 0) {
      const done = report.steps.length > 0 ? `: ${report.steps.join(' ')}` : '.'
      void vscode.window.showInformationMessage(`Kiwipow Agent: "${report.feature}" is on contract${done}`)
      return
    }
    const problems = `${left} contract problem${left === 1 ? '' : 's'}`
    void vscode.window.showWarningMessage(
      `Kiwipow Agent: "${report.feature}" has ${problems}; ${handed ? 'the planner is rearranging the spec' : 'see the plan bar'}.`,
    )
  }

  /** A repair the planner finished: the mechanical part runs again; true when problems remain, so the caller stops there. */
  async continueRepair(feature: string): Promise<boolean> {
    if (!this.repairing.delete(feature)) return false
    const report = await migratePlan(this.deps.workspaceRoot, feature)
    this.reportMigration(report, false)
    await this.deps.sendState()
    return report.problems.length > 0
  }
}
