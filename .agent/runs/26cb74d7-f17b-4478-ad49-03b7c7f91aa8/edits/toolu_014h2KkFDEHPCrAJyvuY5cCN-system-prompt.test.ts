import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { buildSystemPrompt } from '../src/agent/openai-session/system-prompt'
import { CHAT_DECISIONS } from '../src/agent/phases/unfiled-decisions'
import { SPEC_READING } from '../src/agent/phases/blind-plan'
import { memoryWritingInstructions } from '../src/agent/memory/memories'
import { projectScriptsInstruction } from '../src/agent/permissions/package-scripts'
import { CLASH_WITH_CORE } from '../src/agent/instructions/instruction-files'

let cwd: string
let home: string

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'prompt-cwd-'))
  home = await mkdtemp(join(tmpdir(), 'prompt-home-'))
})

afterEach(async () => {
  await rm(cwd, { recursive: true, force: true })
  await rm(home, { recursive: true, force: true })
})

async function file(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, content)
}

describe('buildSystemPrompt', () => {
  it('each_existing_instruction_file_is_a_section_named_by_its_path_global_before_workspace', async () => {
    await file(join(home, '.claude', 'CLAUDE.md'), 'global claude')
    await file(join(home, '.claude', 'AGENTS.md'), 'global agents')
    await file(join(home, '.codex', 'AGENTS.md'), 'codex agents')
    await file(join(home, 'AGENTS.md'), 'home agents')
    await file(join(cwd, 'CLAUDE.md'), 'project claude')
    await file(join(cwd, 'AGENTS.md'), 'project agents')
    const prompt = await buildSystemPrompt(cwd, undefined, home)
    const order = ['global claude', 'global agents', 'codex agents', 'home agents', 'project claude', 'project agents']
    const positions = order.map((text) => prompt.indexOf(text))
    expect(positions.every((p) => p >= 0)).toBe(true)
    expect([...positions].sort((a, b) => a - b)).toEqual(positions)
    expect(prompt).toContain(`# Instructions from ${join(home, '.claude', 'CLAUDE.md')}\n\nglobal claude`)
    expect(prompt).toContain(`# Instructions from ${join(cwd, 'AGENTS.md')}\n\nproject agents`)
  })

  it('missing_and_blank_instruction_files_add_nothing', async () => {
    await file(join(cwd, 'AGENTS.md'), '  \n\n')
    const prompt = await buildSystemPrompt(cwd, undefined, home)
    expect(prompt).not.toContain('# Instructions from')
  })

  it('profile_prompt_file_comes_after_the_instruction_files', async () => {
    await file(join(cwd, 'CLAUDE.md'), 'project claude')
    await file(join(cwd, 'docs', 'prompt.md'), 'profile prompt')
    const prompt = await buildSystemPrompt(cwd, 'docs/prompt.md', home)
    expect(prompt.indexOf('project claude')).toBeLessThan(prompt.indexOf('profile prompt'))
  })

  it('a_decision_settled_in_chat_is_recorded_as_unfiled_for_the_blind_planner', async () => {
    expect(await buildSystemPrompt(cwd, undefined, home)).toContain(CHAT_DECISIONS)
  })

  it('a_chat_keeps_to_the_approved_specs_and_asks_before_breaking_a_rule', async () => {
    expect(await buildSystemPrompt(cwd, undefined, home)).toContain(SPEC_READING)
  })

  it('a_correction_or_a_standing_rule_is_told_apart_from_a_single_use_fact_and_written_down', async () => {
    expect(await buildSystemPrompt(cwd, undefined, home)).toContain(memoryWritingInstructions(cwd, home))
  })

  it('a_node_project_runs_its_tools_through_npm_run_scripts', async () => {
    await file(join(cwd, 'package.json'), '{}')
    const prompt = await buildSystemPrompt(cwd, undefined, home)
    expect(prompt).toContain(projectScriptsInstruction(cwd))
    expect(prompt).toContain('`npm run <script>`')
  })

  it('a_bun_project_runs_its_tools_through_bun_run_scripts', async () => {
    await file(join(cwd, 'package.json'), '{}')
    await file(join(cwd, 'bun.lock'), '')
    expect(await buildSystemPrompt(cwd, undefined, home)).toContain('`bun run <script>`')
  })

  it('a_project_without_package_json_is_not_told_about_scripts', async () => {
    expect(projectScriptsInstruction(cwd)).toBe('')
  })
})
