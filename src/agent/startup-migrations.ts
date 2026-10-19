import * as vscode from 'vscode'
import { homedir } from 'node:os'
import { ensureAgentDirIgnored } from './agent-dir-ignore'
import { KIWI_DIR, migrateLayout, type LayoutReport } from './kiwi-dir'
import { sweepPlans, type SweepReport } from './phases/plan-housekeeping'
import { followSpecRenames, type IdentityReport } from './phases/spec-identity'
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

function logSpecIdentity(report: IdentityReport, output: vscode.OutputChannel): void {
  for (const path of report.stamped) output.appendLine(`spec ids: gave ${path} an id`)
  for (const { from, to } of report.renamed) output.appendLine(`spec ids: ${from} is now ${to}, its working files and sessions follow`)
  for (const path of report.moved) output.appendLine(`spec ids: moved ${path} to the spec's new name`)
  for (const path of report.blocked) output.appendLine(`spec ids: left ${path}, the spec's new name already holds one`)
}

/** What a renamed spec's sessions follow it with. */
export type FeatureRenames = { followFeatureRename(fromSlug: string, feature: string): Promise<void> }

/** Specs first, then the sessions that go by their names, so the sweep after it finds every board under the name its spec has now. */
async function followSpecs(workspaceRoot: string, sessions: () => FeatureRenames, output: vscode.OutputChannel): Promise<void> {
  const report = await followSpecRenames(workspaceRoot)
  logSpecIdentity(report, output)
  for (const { from, feature } of report.renamed) await sessions().followFeatureRename(from, feature)
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
export function runStartupMigrations(workspaceRoot: string, output: vscode.OutputChannel, sessions: () => FeatureRenames): void {
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
  // A spec that cannot be followed still gets swept: its files then go by the name it last had, as they did before ids.
  const followed = migrated.then(() => followSpecs(workspaceRoot, sessions, output)).catch((error: unknown) => output.appendLine(`could not follow renamed specs: ${errorMessage(error)}`))
  void followed.then(() => sweepPlans(workspaceRoot, new Date())).then(
    (report) => logPlanHousekeeping(report, output),
    (error: unknown) => output.appendLine(`plan housekeeping failed: ${errorMessage(error)}`),
  )
}
