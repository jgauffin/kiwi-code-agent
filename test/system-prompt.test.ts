import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { buildSystemPrompt } from '../src/agent/openai-session/system-prompt'

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
})
