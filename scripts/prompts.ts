/**
 * Writes PROMPTS.md: every system prompt, kickoff, handoff, injected context
 * and tool description the models see, each with a link to where it lives.
 * Prompts are rendered by calling the real functions with placeholder
 * arguments, so the file never drifts from the code. Run: npm run prompts
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  BLIND_PLAN_TOOLS,
  blindPlanPrompt,
  decisionsHandoffPrompt,
  docsReviewPrompt,
  migrateSpecPrompt,
  resumePlanPrompt,
  rulingsHandoffPrompt,
} from '../src/agent/phases/blind-plan'
import { CLEANUP_TOOLS, cleanupKickoff, cleanupPrompt } from '../src/agent/phases/cleanup'
import { agentsMdTidyKickoff } from '../src/agent/instructions/agents-md-tidy'
import { DOCS_EVALUATION_TOOLS, docsEvaluationKickoff, docsEvaluationPrompt } from '../src/agent/phases/docs-evaluation'
import { FILE_DECISIONS_TOOLS, fileDecisionsKickoff, fileDecisionsPrompt } from '../src/agent/phases/file-decisions'
import { DOCS_MAP_TOOLS, docsMapKickoff, docsMapPrompt } from '../src/agent/phases/docs-map'
import { IMPLEMENT_TOOLS, implementKickoff, implementPrompt } from '../src/agent/phases/implement'
import { RECONCILE_TOOLS, reconcileKickoff, reconcilePrompt } from '../src/agent/phases/reconcile'
import { reviewPrompt } from '../src/agent/phases/review-handoff'
import { verificationHandoffPrompt } from '../src/agent/phases/verification'
import { docsMapSection } from '../src/agent/docs-map/session-context'
import { repoMapSection } from '../src/agent/repo-map/session-context'
import { buildSystemPrompt } from '../src/agent/openai-session/system-prompt'
import { decisionPrompt, questionPrompt } from '../src/agent/session/session-manager'
import { UNANSWERED_RESULT } from '../src/agent/session/user-question'
import { OutlineGate } from '../src/agent/openai-session/tools/markdown/outline-gate'
import { toDefinition, type Tool } from '../src/agent/openai-session/tools/tool'
import { readTool } from '../src/agent/openai-session/tools/read'
import { writeTool } from '../src/agent/openai-session/tools/write'
import { editTool } from '../src/agent/openai-session/tools/edit'
import { globTool } from '../src/agent/openai-session/tools/glob'
import { grepTool } from '../src/agent/openai-session/tools/grep'
import { bashTool } from '../src/agent/openai-session/tools/bash'
import { jsonQueryTool, jsonSchemaTool } from '../src/agent/openai-session/tools/json'
import { askUserTool } from '../src/agent/openai-session/tools/ask-user'
import { copyTool, moveTool } from '../src/agent/openai-session/tools/move-copy'
import { runScriptTool } from '../src/agent/openai-session/tools/run-script'
import { markdownSearchTool } from '../src/agent/openai-session/tools/markdown-search'
import { specSearchTool } from '../src/agent/phases/spec-search'
import { skillTool } from '../src/agent/openai-session/tools/skill'

const OUT = 'PROMPTS.md'
const F = '<feature>'
const CWD = '<workspace>'

/** `[file:line](file#Lline)` for the first line containing `anchor`; a missing anchor fails the run so the file never points at nothing. */
function at(file: string, anchor: string): string {
  const index = readFileSync(file, 'utf8').split(/\r?\n/).findIndex((line) => line.includes(anchor))
  if (index === -1) throw new Error(`Anchor "${anchor}" not found in ${file}`)
  return `[${file}:${index + 1}](${file}#L${index + 1})`
}

const block = (text: string, lang = ''): string => `~~~~${lang}\n${text.trimEnd()}\n~~~~`

type Entry = { title: string; source: string; note?: string; text: string; lang?: string }

const entry = (e: Entry): string =>
  [`### ${e.title}`, '', `Source: ${e.source}${e.note ? `. ${e.note}.` : ''}`, '', block(e.text, e.lang)].join('\n')

const section = (title: string, intro: string, entries: Entry[]): string =>
  [`## ${title}`, '', intro, '', entries.map(entry).join('\n\n')].join('\n')

const phases = 'src/agent/phases'
const tools = 'src/agent/openai-session/tools'

async function outlineGateMessage(): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'prompts-'))
  try {
    const doc = join(dir, 'long.md')
    writeFileSync(doc, ['# Long doc', '', ...Array.from({ length: 250 }, (_, i) => (i % 50 === 0 ? `## Section ${i / 50 + 1}` : `line ${i}`))].join('\n'))
    const outcome = await new OutlineGate(dir).preToolUse({ toolName: 'Read', input: { file_path: 'long.md' } } as never)
    if (!outcome || !('deny' in outcome)) throw new Error('OutlineGate did not answer a long doc with its outline')
    return String(outcome.deny)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function toolEntry(tool: Tool, file: string): Entry {
  const def = toDefinition(tool)
  return {
    title: def.name,
    source: at(file, `'${def.name}'`),
    text: `${def.description}\n\nParameters:\n${JSON.stringify(def.parameters, null, 2)}`,
  }
}

async function main(): Promise<void> {
  const reviewBody = ['## Goal', 'Placeholder.', '', '## Scenario', '- **<rule name>**: placeholder rule'].join('\n')
  const verifyRule = { match: '<glob>', command: '<test command>', project: '<project file glob>' }
  const failure = { command: '<test command>', cwd: CWD, output: '<test output>' }
  const question = { questions: [{ header: '<header>', question: '<question>', options: [{ label: '<option>' }] }] }
  const permission = { type: 'permission_request', requestId: 'r', toolName: '<Tool>', input: { '<arg>': '<value>' } } as never

  const modes = [
    '| Mode | System prompt | Context appended | Tools |',
    '| --- | --- | --- | --- |',
    `| chat (Claude SDK) | Claude Code's own default prompt; the workspace's CLAUDE.md and .claude/ apply (\`settingSources: project, local\`) | none | engine default + own tools + workspace MCP |`,
    '| chat (OpenAI-compatible) | [Default system prompt](#default-system-prompt-openai-compatible-engine) + instruction files + profile prompt file | none | all own tools + skills + workspace MCP |',
    `| plan | [blindPlanPrompt](#blindplanprompt) | docs map | ${BLIND_PLAN_TOOLS.join(', ')} |`,
    `| docs | [docsEvaluationPrompt](#docsevaluationprompt) | docs map | ${DOCS_EVALUATION_TOOLS.join(', ')} |`,
    `| docs-map | [docsMapPrompt](#docsmapprompt) | none | ${DOCS_MAP_TOOLS.join(', ')} |`,
    `| file-decisions | [fileDecisionsPrompt](#filedecisionsprompt) | docs map | ${FILE_DECISIONS_TOOLS.join(', ')} |`,
    `| reconcile | [reconcilePrompt](#reconcileprompt) | repo map | ${RECONCILE_TOOLS.join(', ')} |`,
    `| implement | [implementPrompt](#implementprompt) | repo map | ${IMPLEMENT_TOOLS.join(', ')} |`,
    `| cleanup | [cleanupPrompt](#cleanupprompt) | none | ${CLEANUP_TOOLS.join(', ')} |`,
  ].join('\n')

  const systemPrompts: Entry[] = [
    { title: 'Default system prompt (OpenAI-compatible engine)', source: at('src/agent/openai-session/system-prompt.ts', 'export async function buildSystemPrompt'), note: 'Instruction files (CLAUDE.md, AGENTS.md; global then workspace, see src/agent/instructions/instruction-files.ts) and the profile prompt file are appended at run time', text: await buildSystemPrompt(CWD, undefined, '<home>') },
    { title: 'blindPlanPrompt', source: at(`${phases}/blind-plan.ts`, 'export function blindPlanPrompt'), text: blindPlanPrompt(F, CWD) },
    { title: 'docsEvaluationPrompt', source: at(`${phases}/docs-evaluation.ts`, 'export function docsEvaluationPrompt'), text: docsEvaluationPrompt(CWD) },
    { title: 'docsMapPrompt', source: at(`${phases}/docs-map.ts`, 'export function docsMapPrompt'), text: docsMapPrompt(CWD) },
    { title: 'fileDecisionsPrompt', source: at(`${phases}/file-decisions.ts`, 'export function fileDecisionsPrompt'), text: fileDecisionsPrompt(CWD) },
    { title: 'reconcilePrompt', source: at(`${phases}/reconcile.ts`, 'export function reconcilePrompt'), text: reconcilePrompt(F, CWD) },
    { title: 'implementPrompt', source: at(`${phases}/implement.ts`, 'export function implementPrompt'), note: 'Rendered with one example verify rule', text: implementPrompt(F, CWD, [verifyRule]) },
    { title: 'cleanupPrompt', source: at(`${phases}/cleanup.ts`, 'export function cleanupPrompt'), text: cleanupPrompt(F, CWD, { source: { functionLines: 60, functionComplexity: 15, typeLines: 200, fileLines: 400 }, tests: { functionLines: 120, functionComplexity: 15, typeLines: 600, fileLines: 1200 }, testGlobs: [] }) },
  ]

  const contexts: Entry[] = [
    { title: 'Docs map section', source: at('src/agent/docs-map/session-context.ts', 'export function docsMapSection'), note: 'The note varies with build outcome, see src/agent/session/generated-context.ts', text: docsMapSection({ note: 'The docs map was current at this session\'s start.', summary: '<docs map summary>' }) },
    { title: 'Repo map section', source: at('src/agent/repo-map/session-context.ts', 'export function repoMapSection'), text: repoMapSection({ note: 'The repo map was current at this session\'s start.', summary: '<repo map summary>' }) },
  ]

  const messages: Entry[] = [
    { title: 'docsEvaluationKickoff', source: at(`${phases}/docs-evaluation.ts`, 'export function docsEvaluationKickoff'), text: docsEvaluationKickoff() },
    { title: 'fileDecisionsKickoff', source: at(`${phases}/file-decisions.ts`, 'export function fileDecisionsKickoff'), text: fileDecisionsKickoff() },
    { title: 'agentsMdTidyKickoff (workspace)', source: at('src/agent/instructions/agents-md-tidy.ts', 'export function agentsMdTidyKickoff'), text: agentsMdTidyKickoff('project', `${CWD}/AGENTS.md`, ['<bundle name>']) },
    { title: 'agentsMdTidyKickoff (person)', source: at('src/agent/instructions/agents-md-tidy.ts', 'export function agentsMdTidyKickoff'), text: agentsMdTidyKickoff('user', '<home>/AGENTS.md', []) },
    { title: 'docsMapKickoff', source: at(`${phases}/docs-map.ts`, 'export function docsMapKickoff'), text: docsMapKickoff(['docs/<doc>.md']) },
    { title: 'resumePlanPrompt', source: at(`${phases}/blind-plan.ts`, 'export function resumePlanPrompt'), text: resumePlanPrompt(F) },
    { title: 'migrateSpecPrompt', source: at(`${phases}/blind-plan.ts`, 'export function migrateSpecPrompt'), text: migrateSpecPrompt(F, ['<problem>']) },
    { title: 'reviewPrompt', source: at(`${phases}/review-handoff.ts`, 'export function reviewPrompt'), text: reviewPrompt({ feature: F, round: { number: 1, comments: [{ target: '<rule name>', text: '<comment>' }], strikes: ['<struck rule>'] }, body: reviewBody, struck: ['<struck rule>'] }) },
    { title: 'decisionsHandoffPrompt', source: at(`${phases}/blind-plan.ts`, 'export function decisionsHandoffPrompt'), text: decisionsHandoffPrompt(F, ['<decision title>']) },
    { title: 'rulingsHandoffPrompt', source: at(`${phases}/blind-plan.ts`, 'export function rulingsHandoffPrompt'), text: rulingsHandoffPrompt(F, [{ title: '<decision title>', ruling: '<ruling>' }]) },
    { title: 'docsReviewPrompt', source: at(`${phases}/blind-plan.ts`, 'export function docsReviewPrompt'), text: docsReviewPrompt(F) },
    { title: 'reconcileKickoff (fresh)', source: at(`${phases}/reconcile.ts`, 'export function reconcileKickoff'), text: reconcileKickoff(false) },
    { title: 'reconcileKickoff (continued)', source: at(`${phases}/reconcile.ts`, 'export function reconcileKickoff'), text: reconcileKickoff(true) },
    { title: 'implementKickoff (fresh)', source: at(`${phases}/implement.ts`, 'export function implementKickoff'), text: implementKickoff(undefined) },
    { title: 'implementKickoff (continuing the mapping)', source: at(`${phases}/implement.ts`, 'export function implementKickoff'), text: implementKickoff('mapping') },
    { title: 'implementKickoff (continuing an implementer)', source: at(`${phases}/implement.ts`, 'export function implementKickoff'), text: implementKickoff('implement') },
    { title: 'verificationHandoffPrompt', source: at(`${phases}/verification.ts`, 'export function verificationHandoffPrompt'), text: verificationHandoffPrompt(F, [failure], CWD) },
    { title: 'cleanupKickoff (fresh)', source: at(`${phases}/cleanup.ts`, 'export function cleanupKickoff'), text: cleanupKickoff('<oversized units report>', false) },
    { title: 'cleanupKickoff (continued)', source: at(`${phases}/cleanup.ts`, 'export function cleanupKickoff'), text: cleanupKickoff('<oversized units report>', true) },
    { title: 'questionPrompt (answered, resumed engine)', source: at('src/agent/session/session-manager.ts', 'export function questionPrompt'), text: questionPrompt(question, { kind: 'answered', answers: [{ chosen: ['<option>'] }] }) },
    { title: 'questionPrompt (unanswered)', source: at('src/agent/session/user-question.ts', 'export const UNANSWERED_RESULT'), text: UNANSWERED_RESULT },
    { title: 'decisionPrompt (allow)', source: at('src/agent/session/session-manager.ts', 'export function decisionPrompt'), text: decisionPrompt(permission, { kind: 'allow' } as never) },
    { title: 'decisionPrompt (deny)', source: at('src/agent/session/session-manager.ts', 'export function decisionPrompt'), text: decisionPrompt(permission, { kind: 'deny', message: '<reason>' } as never) },
    { title: 'OutlineGate (first whole-file Read of a long markdown doc)', source: at(`${tools}/markdown/outline-gate.ts`, 'export class OutlineGate'), text: await outlineGateMessage() },
  ]

  const toolEntries: Entry[] = [
    toolEntry(readTool, `${tools}/read.ts`),
    toolEntry(writeTool, `${tools}/write.ts`),
    toolEntry(editTool, `${tools}/edit.ts`),
    toolEntry(moveTool, `${tools}/move-copy.ts`),
    toolEntry(copyTool, `${tools}/move-copy.ts`),
    toolEntry(globTool, `${tools}/glob.ts`),
    toolEntry(grepTool, `${tools}/grep.ts`),
    toolEntry(markdownSearchTool(), `${tools}/markdown-search.ts`),
    toolEntry(specSearchTool(), 'src/agent/phases/spec-search.ts'),
    toolEntry(jsonSchemaTool, `${tools}/json.ts`),
    toolEntry(jsonQueryTool, `${tools}/json.ts`),
    toolEntry(bashTool('bash'), `${tools}/bash.ts`),
    toolEntry(runScriptTool(), `${tools}/run-script.ts`),
    toolEntry(askUserTool, `${tools}/ask-user.ts`),
    toolEntry(skillTool([{ name: '<skill>', description: '<skill description>', dir: '<dir>' }]), `${tools}/skill.ts`),
  ]

  const skillsDir = 'assets/plugin/skills'
  const skills: Entry[] = readdirSync(skillsDir).sort().map((name) => {
    const skillFile = `${skillsDir}/${name}/SKILL.md`
    return { title: name, source: `[${skillFile}](${skillFile})`, text: readFileSync(skillFile, 'utf8'), lang: 'markdown' }
  })

  const doc = [
    '# Prompts and instructions',
    '',
    'Generated by `npm run prompts` ([scripts/prompts.ts](scripts/prompts.ts)); git-ignored, do not edit. Every prompt is rendered by calling its function with placeholders: `<feature>` for the feature name (its slug is `feature`), `<workspace>` for the workspace root, other `<...>` for run-time values.',
    '',
    'Mode prompts replace the engine\'s system prompt on both engines. On the Claude SDK engine the own tools reach the model as `mcp__kiwi__<name>`.',
    '',
    '## Modes',
    '',
    modes,
    '',
    section('System prompts', 'One per mode, as set in `modeSetup` in [src/extension.ts](src/extension.ts).', systemPrompts),
    '',
    section('Context appended to system prompts', 'Appended per mode, see the table above.', contexts),
    '',
    section('Kickoffs and handoffs', 'User-turn messages the extension sends into a session.', messages),
    '',
    section('Tools', 'Own tools as the model sees them. The Claude SDK engine also has Claude Code\'s built-in tools, whose descriptions are not ours.', toolEntries),
    '',
    section('Shipped skills', 'Loaded on demand through the Skill tool.', skills),
    '',
  ].join('\n')

  writeFileSync(OUT, doc, 'utf8')
  console.log(`Wrote ${OUT}`)
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
