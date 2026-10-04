import * as vscode from 'vscode'
import { homedir } from 'node:os'
import { ensureAgentDirIgnored } from './agent-dir-ignore'
import { KIWI_DIR, migrateLayout, type LayoutReport } from './kiwi-dir'
import { sweepPlans, type SweepReport } from './phases/plan-housekeeping'
import { FUTURE_FILE, migrateUnfiled } from './phases/unfiled-decisions'
import { errorMessage } from '../error-message'

function logLayoutMigration(report: LayoutReport, output: vscode.OutputChannel): void {
  for (const move of report.moved) output.appendLine(`layout: moved ${move.from} to ${move.to}`)
  for (const path of report.blocked) output.appendLine(`layout: left ${path}, its new place already holds one of that name`)
  for (const failure of report.failed) output.appendLine(`layout: could not move ${failure.path}: ${failure.reason}`)
}

function logUnfiledSplit(result: { changed: boolean; moved: number }, output: vscode.OutputChannel): void {
  if (result.changed) {
    output.appendLine(
      `unfiled decisions: dropped the built lines, moved ${result.moved} entr${result.moved === 1 ? 'y' : 'ies'} still to build to ${FUTURE_FILE}`,
    )
  }
}

function logPlanHousekeeping(report: SweepReport, output: vscode.OutputChannel): void {
  for (const path of report.converted) output.appendLine(`plan housekeeping: converted ${path} to JSON`)
  for (const path of report.moved) output.appendLine(`plan housekeeping: moved ${path} to the working files`)
  for (const path of report.blocked) output.appendLine(`plan housekeeping: left ${path}, the working files already hold one of that name`)
  for (const { path, status } of report.recorded) output.appendLine(`plan housekeeping: marked ${path} ${status}`)
  for (const path of report.removed) output.appendLine(`plan housekeeping: removed ${path}`)
}

/**
 * The housekeeping that brings an older layout and its files up to date: it
 * reads the current layout, so an older one is moved first, and each later
 * step waits on that before touching what it left behind.
 */
export function runStartupMigrations(workspaceRoot: string, output: vscode.OutputChannel): void {
  const migrated = migrateLayout(workspaceRoot, homedir()).then(
    (report) => logLayoutMigration(report, output),
    (error: unknown) => output.appendLine(`layout migration failed: ${errorMessage(error)}`),
  )
  void migrated.then(() => ensureAgentDirIgnored(workspaceRoot)).then(
    (result) => {
      if (result === 'added') output.appendLine(`added ${KIWI_DIR}/ to .gitignore`)
    },
    (error: unknown) => output.appendLine(`could not add ${KIWI_DIR}/ to .gitignore: ${errorMessage(error)}`),
  )
  void migrated.then(() => migrateUnfiled(workspaceRoot)).then(
    (result) => logUnfiledSplit(result, output),
    (error: unknown) => output.appendLine(`could not split the unfiled decisions: ${errorMessage(error)}`),
  )
  void migrated.then(() => sweepPlans(workspaceRoot, new Date())).then(
    (report) => logPlanHousekeeping(report, output),
    (error: unknown) => output.appendLine(`plan housekeeping failed: ${errorMessage(error)}`),
  )
}
