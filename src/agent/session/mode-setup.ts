import type { Limits } from '../cleanup/oversized'
import { projectMemoryDir } from '../memory/memories'
import { DocsMapContract } from '../docs-map/entry'
import { CODE_OUTLINE_TOOL } from '../code-outline/code-outline-tool'
import { CODE_SEARCH_TOOL } from '../code-outline/code-search'
import { BLIND_PLAN_TOOLS, blindPlanPrompt, blindPlanScope } from '../phases/blind-plan'
import { CLEANUP_TOOLS, cleanupPrompt, cleanupScope } from '../phases/cleanup'
import { CODE_PLAN_TOOLS, codePlanPrompt } from '../phases/code-plan'
import { DOC_MIGRATION_TOOLS, docMigrationPrompt, docMigrationScope, specsWithWorkInFlight } from '../phases/doc-migration'
import { DOCS_MAP_TOOLS, docsMapPrompt, docsMapScope } from '../phases/docs-map'
import { FILE_DECISIONS_TOOLS, fileDecisionsPrompt, fileDecisionsScope } from '../phases/file-decisions'
import { IMPLEMENT_TOOLS, implementPrompt } from '../phases/implement'
import { RECONCILE_TOOLS, reconcilePrompt, reconcileScope } from '../phases/reconcile'
import { ScenarioContextContract } from '../phases/scenario-context'
import { ScopeGuard, readableIn } from '../phases/scope-guard'
import { SpecContract } from '../phases/spec-model'
import { existingSpecFolders, resolveSpecFoldersMode, type SpecFoldersSetting } from '../phases/spec-folders'
import { TaskBoardGuard } from '../openai-session/tools/task-board'
import { RESEARCH_SUB_AGENT, shippedEntry, type SubAgentCatalogEntry } from '../sub-agents/sub-agent-index'
import type { VerifyRule } from '../phases/verification'
import { composeHooks, type SessionHooks } from './hooks'
import type { SessionRecord } from './session-manager'

/** What a session's mode dictates, independent of engine: hooks, prompt, tool set, and the files a search may hand back. */
export type ModeSetup = {
  hooks?: SessionHooks
  systemPrompt?: string
  toolNames?: string[]
  readable?: (relPath: string) => boolean
  /** A sub agent this mode offers on its own, beside whatever a session that may read the code is offered: the blind planner's research lookup. */
  subAgents?: SubAgentCatalogEntry[]
}

/** What the modes read from the workspace and its settings, and the maps a prompt carries, built when behind. */
export type ModeContext = {
  workspaceRoot: string
  verifyRules(): VerifyRule[]
  /** Docs the blind planner must not see, so neither the map nor the evaluation may describe them. */
  planIgnore(): string[]
  /** `kiwiAgent.specFolders`, as the setting's own value, resolved against the workspace where a new spec's folder is decided. */
  specFoldersSetting(): SpecFoldersSetting
  cleanupLimits(): Limits
  withMap(record: SessionRecord, systemPrompt: string): Promise<string>
  withDocs(record: SessionRecord, systemPrompt: string): Promise<string>
  /** The project's memory index, for every mode but the blind planner. */
  withMemories(record: SessionRecord, systemPrompt: string): Promise<string>
  /** The workspace's and the person's instruction files — an applied bundle rule among them — for every mode but the blind planner. */
  withInstructions(record: SessionRecord, systemPrompt: string): Promise<string>
}

/**
 * Whether a session set up this way may read the code: a tool set that
 * carries one of the code-reading tools does, and a chat with no tool set of
 * its own, offered every built-in tool, does too. A feature-planning session
 * and the docs-only phases carry neither tool and so do not.
 */
export function mayReadCode(setup: ModeSetup): boolean {
  return !setup.toolNames || setup.toolNames.includes(CODE_OUTLINE_TOOL) || setup.toolNames.includes(CODE_SEARCH_TOOL)
}

export async function modeSetup(record: SessionRecord, ctx: ModeContext): Promise<ModeSetup> {
  const { workspaceRoot } = ctx
  // A chat may write a spec when asked to, held to the contract like the planner's.
  const chat = { hooks: new SpecContract(workspaceRoot) }
  if (record.access === 'full') return chat
  switch (record.mode) {
    case 'chat':
      return chat
    case 'implement':
      return implementModeSetup(record, ctx)
    case 'plan':
      return planModeSetup(record, ctx)
    case 'code-plan':
      return codePlanModeSetup(record, ctx)
    case 'file-decisions':
      return fileDecisionsModeSetup(record, ctx)
    case 'doc-migration':
      return docMigrationModeSetup(record, ctx)
    case 'docs-map':
      return docsMapModeSetup(record, ctx)
    case 'reconcile':
      return reconcileModeSetup(record, ctx)
    case 'cleanup':
      return cleanupModeSetup(record, ctx)
  }
}

async function implementModeSetup(record: SessionRecord, ctx: ModeContext): Promise<ModeSetup> {
  const { workspaceRoot } = ctx
  if (!record.feature) throw new Error('An implement session needs a feature name')
  return {
    // The user's answers amend the task's rules, held to the contract like the planner's writes.
    hooks: composeHooks(new TaskBoardGuard(workspaceRoot, record.feature), new SpecContract(workspaceRoot)),
    systemPrompt: await ctx.withInstructions(record, await ctx.withMemories(record, await ctx.withMap(record, implementPrompt(record.feature, workspaceRoot, ctx.verifyRules())))),
    toolNames: IMPLEMENT_TOOLS,
  }
}

async function planModeSetup(record: SessionRecord, ctx: ModeContext): Promise<ModeSetup> {
  const { workspaceRoot } = ctx
  if (!record.feature) throw new Error('A plan session needs a feature name')
  const folderMode = await resolveSpecFoldersMode(workspaceRoot, ctx.specFoldersSetting())
  const folders = folderMode === 'by-domain' ? await existingSpecFolders(workspaceRoot) : []
  const scope = blindPlanScope(record.feature, ctx.planIgnore(), folderMode)
  return {
    // The contract answers on the write that broke it, so the planner fixes the spec in the same turn.
    hooks: composeHooks(new ScopeGuard(workspaceRoot, scope), new SpecContract(workspaceRoot)),
    systemPrompt: await ctx.withDocs(record, blindPlanPrompt(record.feature, workspaceRoot, folderMode, folders)),
    toolNames: BLIND_PLAN_TOOLS,
    readable: readableIn(scope),
    // Offered on its own: a blind planner reads no code, so it is otherwise offered no sub agent at all.
    subAgents: [shippedEntry(RESEARCH_SUB_AGENT)],
  }
}

async function codePlanModeSetup(record: SessionRecord, ctx: ModeContext): Promise<ModeSetup> {
  const { workspaceRoot } = ctx
  // Read-only by its tool set: nothing to scope, and the build happens once the plan is approved.
  return {
    systemPrompt: await ctx.withInstructions(record, await ctx.withMemories(record, await ctx.withMap(record, codePlanPrompt(workspaceRoot)))),
    toolNames: CODE_PLAN_TOOLS,
  }
}

async function fileDecisionsModeSetup(record: SessionRecord, ctx: ModeContext): Promise<ModeSetup> {
  const { workspaceRoot } = ctx
  const scope = fileDecisionsScope(ctx.planIgnore())
  return {
    hooks: composeHooks(new ScopeGuard(workspaceRoot, scope), new SpecContract(workspaceRoot)),
    systemPrompt: await ctx.withInstructions(record, await ctx.withMemories(record, fileDecisionsPrompt(workspaceRoot))),
    toolNames: FILE_DECISIONS_TOOLS,
    readable: readableIn(scope),
  }
}

async function docMigrationModeSetup(record: SessionRecord, ctx: ModeContext): Promise<ModeSetup> {
  const { workspaceRoot } = ctx
  // Never promoted to full access: the job never reads code, for its whole life.
  const folderMode = await resolveSpecFoldersMode(workspaceRoot, ctx.specFoldersSetting())
  const folders = folderMode === 'by-domain' ? await existingSpecFolders(workspaceRoot) : []
  const blockedMoves = folderMode === 'by-domain' ? await specsWithWorkInFlight(workspaceRoot) : []
  const scope = docMigrationScope(ctx.planIgnore(), folderMode)
  return {
    // The migrated drafts it writes are held to the contract like the planner's.
    hooks: composeHooks(new ScopeGuard(workspaceRoot, scope), new SpecContract(workspaceRoot)),
    systemPrompt: await ctx.withInstructions(record, await ctx.withMemories(record, await ctx.withDocs(record, docMigrationPrompt(workspaceRoot, folderMode, folders, blockedMoves)))),
    toolNames: DOC_MIGRATION_TOOLS,
    readable: readableIn(scope),
  }
}

async function docsMapModeSetup(record: SessionRecord, ctx: ModeContext): Promise<ModeSetup> {
  const { workspaceRoot } = ctx
  return {
    // The entry contract answers on the write that broke it, so a bad anchor never reaches a planner's prompt.
    hooks: composeHooks(new ScopeGuard(workspaceRoot, docsMapScope(record.files ?? [])), new DocsMapContract(workspaceRoot)),
    systemPrompt: await ctx.withInstructions(record, await ctx.withMemories(record, docsMapPrompt(workspaceRoot))),
    toolNames: DOCS_MAP_TOOLS,
  }
}

async function reconcileModeSetup(record: SessionRecord, ctx: ModeContext): Promise<ModeSetup> {
  const { workspaceRoot } = ctx
  if (!record.feature) throw new Error('A reconcile session needs a feature name')
  return {
    hooks: composeHooks(
      new ScopeGuard(workspaceRoot, reconcileScope(record.feature, projectMemoryDir(workspaceRoot))),
      new SpecContract(workspaceRoot),
      new ScenarioContextContract(workspaceRoot, record.feature),
    ),
    systemPrompt: await ctx.withInstructions(record, await ctx.withMemories(record, await ctx.withMap(record, reconcilePrompt(record.feature, workspaceRoot)))),
    toolNames: RECONCILE_TOOLS,
  }
}

async function cleanupModeSetup(record: SessionRecord, ctx: ModeContext): Promise<ModeSetup> {
  const { workspaceRoot } = ctx
  if (!record.feature || !record.files) throw new Error('A cleanup session needs a feature name and the files to split')
  return {
    hooks: new ScopeGuard(workspaceRoot, cleanupScope(record.files, projectMemoryDir(workspaceRoot))),
    systemPrompt: await ctx.withInstructions(record, await ctx.withMemories(record, cleanupPrompt(record.feature, workspaceRoot, ctx.cleanupLimits()))),
    toolNames: CLEANUP_TOOLS,
  }
}
