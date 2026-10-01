import type { Limits } from '../cleanup/oversized'
import { DocsMapContract } from '../docs-map/entry'
import { BLIND_PLAN_TOOLS, blindPlanPrompt, blindPlanScope } from '../phases/blind-plan'
import { CLEANUP_TOOLS, cleanupPrompt, cleanupScope } from '../phases/cleanup'
import { CODE_PLAN_TOOLS, codePlanPrompt } from '../phases/code-plan'
import { DOC_MIGRATION_TOOLS, docMigrationPrompt, docMigrationScope } from '../phases/doc-migration'
import { DOCS_EVALUATION_TOOLS, docsEvaluationPrompt, docsEvaluationScope } from '../phases/docs-evaluation'
import { DOCS_MAP_TOOLS, docsMapPrompt, docsMapScope } from '../phases/docs-map'
import { FILE_DECISIONS_TOOLS, fileDecisionsPrompt, fileDecisionsScope } from '../phases/file-decisions'
import { IMPLEMENT_TOOLS, implementPrompt } from '../phases/implement'
import { RECONCILE_TOOLS, reconcilePrompt, reconcileScope } from '../phases/reconcile'
import { ScenarioContextContract } from '../phases/scenario-context'
import { ScopeGuard, readableIn } from '../phases/scope-guard'
import { SpecContract } from '../phases/spec-model'
import { TaskBoardGuard } from '../openai-session/tools/task-board'
import type { VerifyRule } from '../phases/verification'
import { composeHooks, type SessionHooks } from './hooks'
import type { SessionRecord } from './session-manager'

/** What a session's mode dictates, independent of engine: hooks, prompt, tool set, and the files a search may hand back. */
export type ModeSetup = { hooks?: SessionHooks; systemPrompt?: string; toolNames?: string[]; readable?: (relPath: string) => boolean }

/** What the modes read from the workspace and its settings, and the maps a prompt carries, built when behind. */
export type ModeContext = {
  workspaceRoot: string
  verifyRules(): VerifyRule[]
  /** Docs the blind planner must not see, so neither the map nor the evaluation may describe them. */
  planIgnore(): string[]
  cleanupLimits(): Limits
  withMap(record: SessionRecord, systemPrompt: string): Promise<string>
  withDocs(record: SessionRecord, systemPrompt: string): Promise<string>
  /** The project's memory index, for every mode but the blind planner. */
  withMemories(record: SessionRecord, systemPrompt: string): Promise<string>
  /** The workspace's and the person's instruction files — an applied bundle rule among them — for every mode but the blind planner. */
  withInstructions(record: SessionRecord, systemPrompt: string): Promise<string>
}

export async function modeSetup(record: SessionRecord, ctx: ModeContext): Promise<ModeSetup> {
  const { workspaceRoot } = ctx
  // A chat may write a spec when asked to, held to the contract like the planner's.
  const chat = { hooks: new SpecContract(workspaceRoot) }
  if (record.access === 'full') return chat
  switch (record.mode) {
    case 'chat':
      return chat
    case 'implement': {
      if (!record.feature) throw new Error('An implement session needs a feature name')
      return {
        // The user's answers amend the task's rules, held to the contract like the planner's writes.
        hooks: composeHooks(new TaskBoardGuard(workspaceRoot, record.feature), new SpecContract(workspaceRoot)),
        systemPrompt: await ctx.withInstructions(record, await ctx.withMemories(record, await ctx.withMap(record, implementPrompt(record.feature, workspaceRoot, ctx.verifyRules())))),
        toolNames: IMPLEMENT_TOOLS,
      }
    }
    case 'plan': {
      if (!record.feature) throw new Error('A plan session needs a feature name')
      const scope = blindPlanScope(record.feature, ctx.planIgnore())
      return {
        // The contract answers on the write that broke it, so the planner fixes the spec in the same turn.
        hooks: composeHooks(new ScopeGuard(workspaceRoot, scope), new SpecContract(workspaceRoot)),
        systemPrompt: await ctx.withDocs(record, blindPlanPrompt(record.feature, workspaceRoot)),
        toolNames: BLIND_PLAN_TOOLS,
        readable: readableIn(scope),
      }
    }
    case 'code-plan':
      // Read-only by its tool set: nothing to scope, and the build happens once the plan is approved.
      return {
        systemPrompt: await ctx.withInstructions(record, await ctx.withMemories(record, await ctx.withMap(record, await ctx.withDocs(record, codePlanPrompt(workspaceRoot))))),
        toolNames: CODE_PLAN_TOOLS,
      }
    case 'docs': {
      const scope = docsEvaluationScope(ctx.planIgnore())
      return {
        hooks: new ScopeGuard(workspaceRoot, scope),
        systemPrompt: await ctx.withInstructions(record, await ctx.withMemories(record, await ctx.withDocs(record, docsEvaluationPrompt(workspaceRoot)))),
        toolNames: DOCS_EVALUATION_TOOLS,
        readable: readableIn(scope),
      }
    }
    case 'file-decisions': {
      const scope = fileDecisionsScope(ctx.planIgnore())
      return {
        hooks: composeHooks(new ScopeGuard(workspaceRoot, scope), new SpecContract(workspaceRoot)),
        systemPrompt: await ctx.withInstructions(record, await ctx.withMemories(record, await ctx.withDocs(record, fileDecisionsPrompt(workspaceRoot)))),
        toolNames: FILE_DECISIONS_TOOLS,
        readable: readableIn(scope),
      }
    }
    case 'doc-migration': {
      // Never promoted to full access, unlike the docs evaluation: the job never reads code, for its whole life.
      const scope = docMigrationScope(ctx.planIgnore())
      return {
        // The migrated drafts it writes are held to the contract like the planner's.
        hooks: composeHooks(new ScopeGuard(workspaceRoot, scope), new SpecContract(workspaceRoot)),
        systemPrompt: await ctx.withInstructions(record, await ctx.withMemories(record, await ctx.withDocs(record, docMigrationPrompt(workspaceRoot)))),
        toolNames: DOC_MIGRATION_TOOLS,
        readable: readableIn(scope),
      }
    }
    case 'docs-map': {
      return {
        // The entry contract answers on the write that broke it, so a bad anchor never reaches a planner's prompt.
        hooks: composeHooks(new ScopeGuard(workspaceRoot, docsMapScope(record.files ?? [])), new DocsMapContract(workspaceRoot)),
        systemPrompt: await ctx.withInstructions(record, await ctx.withMemories(record, docsMapPrompt(workspaceRoot))),
        toolNames: DOCS_MAP_TOOLS,
      }
    }
    case 'reconcile': {
      if (!record.feature) throw new Error('A reconcile session needs a feature name')
      return {
        hooks: composeHooks(
          new ScopeGuard(workspaceRoot, reconcileScope(record.feature)),
          new SpecContract(workspaceRoot),
          new ScenarioContextContract(workspaceRoot, record.feature),
        ),
        systemPrompt: await ctx.withInstructions(record, await ctx.withMemories(record, await ctx.withMap(record, reconcilePrompt(record.feature, workspaceRoot)))),
        toolNames: RECONCILE_TOOLS,
      }
    }
    case 'cleanup': {
      if (!record.feature || !record.files) throw new Error('A cleanup session needs a feature name and the files to split')
      return {
        hooks: new ScopeGuard(workspaceRoot, cleanupScope(record.files)),
        systemPrompt: await ctx.withInstructions(record, await ctx.withMemories(record, cleanupPrompt(record.feature, workspaceRoot, ctx.cleanupLimits()))),
        toolNames: CLEANUP_TOOLS,
      }
    }
  }
}
