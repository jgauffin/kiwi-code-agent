import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { indexSkills as indexUnder } from '../src/agent/skills/skill-index'
import { skillTool } from '../src/agent/openai-session/tools/skill'
import { ReadTracker } from '../src/agent/openai-session/tools/read-tracker'
import { toDefinition, type ToolContext } from '../src/agent/openai-session/tools/tool'

let dir: string
let home: string
let ctx: ToolContext

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'skills-'))
  home = await mkdtemp(join(tmpdir(), 'skills-home-'))
  ctx = { cwd: dir, signal: new AbortController().signal, files: new ReadTracker() }
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
  await rm(home, { recursive: true, force: true })
})

async function skill(folder: string, content: string, root = '.claude', base = dir): Promise<void> {
  await mkdir(join(base, root, 'skills', folder), { recursive: true })
  await writeFile(join(base, root, 'skills', folder, 'SKILL.md'), content)
}

const indexSkills = (cwd: string) => indexUnder(cwd, home)

describe('skill index', () => {
  it('lists_each_skill_by_frontmatter_name_and_description', async () => {
    await skill('forms', '---\nname: relaxjs-forms\ndescription: Building forms. Use when wiring submit.\n---\n\n# Forms\n')
    await skill('routing', '---\nname: relaxjs-routing\ndescription: "Client-side routing."\n---\n# Routing\n')
    const skills = await indexSkills(dir)
    expect(skills.map((s) => [s.name, s.description])).toEqual([
      ['relaxjs-forms', 'Building forms. Use when wiring submit.'],
      ['relaxjs-routing', 'Client-side routing.'],
    ])
    expect(skills[0]!.dir).toBe(join(dir, '.claude', 'skills', 'forms'))
  })

  it('folder_name_stands_in_when_frontmatter_has_no_name', async () => {
    await skill('deploy', '---\ndescription: Ship it.\n---\nbody')
    expect((await indexSkills(dir)).map((s) => s.name)).toEqual(['deploy'])
  })

  it('folded_block_description_is_joined_into_one_line', async () => {
    await skill('a', '---\nname: a\ndescription: >\n  First part\n  second part.\n---\nbody')
    expect((await indexSkills(dir))[0]!.description).toBe('First part second part.')
  })

  it('agent_skills_are_indexed_alongside_claude_skills_and_win_on_a_shared_name', async () => {
    await skill('a', '---\nname: shared\ndescription: From .claude.\n---\nbody')
    await skill('b', '---\nname: only-agent\ndescription: Agent only.\n---\nbody', '.agent')
    await skill('c', '---\nname: shared\ndescription: From .agent.\n---\nbody', '.agent')
    const skills = await indexSkills(dir)
    expect(skills.map((s) => [s.name, s.description])).toEqual([
      ['only-agent', 'Agent only.'],
      ['shared', 'From .agent.'],
    ])
  })

  it('user_skills_under_claude_and_agent_roots_are_indexed', async () => {
    await skill('a', '---\nname: user-claude\ndescription: From ~/.claude.\n---\nbody', '.claude', home)
    await skill('b', '---\nname: user-agent\ndescription: From ~/.agent.\n---\nbody', '.agent', home)
    const skills = await indexSkills(dir)
    expect(skills.map((s) => [s.name, s.description])).toEqual([
      ['user-agent', 'From ~/.agent.'],
      ['user-claude', 'From ~/.claude.'],
    ])
    expect(skills[1]!.dir).toBe(join(home, '.claude', 'skills', 'a'))
  })

  it('workspace_skill_replaces_user_skill_with_the_same_name', async () => {
    await skill('a', '---\nname: shared\ndescription: From the user.\n---\nbody', '.agent', home)
    await skill('b', '---\nname: shared\ndescription: From the workspace.\n---\nbody', '.claude')
    const skills = await indexSkills(dir)
    expect(skills.map((s) => [s.name, s.description])).toEqual([['shared', 'From the workspace.']])
  })

  it('a_folder_without_skill_md_and_a_workspace_without_skills_are_not_errors', async () => {
    expect(await indexSkills(dir)).toEqual([])
    await mkdir(join(dir, '.claude', 'skills', 'empty'), { recursive: true })
    expect(await indexSkills(dir)).toEqual([])
  })
})

describe('Skill tool', () => {
  it('description_carries_the_index_so_the_model_can_pick_without_a_lookup', async () => {
    await skill('forms', '---\nname: relaxjs-forms\ndescription: Building forms.\n---\nbody')
    const definition = toDefinition(skillTool(await indexSkills(dir)))
    expect(definition.name).toBe('Skill')
    expect(definition.description).toContain('- relaxjs-forms: Building forms.')
  })

  it('loads_the_body_without_frontmatter_and_names_the_folder_for_relative_paths', async () => {
    await skill('forms', '---\nname: relaxjs-forms\ndescription: Building forms.\n---\n# Forms\n\nSee [ref](reference.md).\n')
    const tool = skillTool(await indexSkills(dir))
    const result = await tool.execute({ name: 'relaxjs-forms' }, ctx)
    expect(result.isError).toBe(false)
    expect(result.text).toContain(join(dir, '.claude', 'skills', 'forms'))
    expect(result.text).toContain('# Forms\n\nSee [ref](reference.md).')
    expect(result.text).not.toContain('description:')
    expect(tool.readOnly).toBe(true)
  })

  it('unknown_skill_is_a_tool_error_naming_the_available_ones', async () => {
    await skill('forms', '---\nname: relaxjs-forms\ndescription: Building forms.\n---\nbody')
    const result = await skillTool(await indexSkills(dir)).execute({ name: 'nope' }, ctx)
    expect(result.isError).toBe(true)
    expect(result.text).toContain('relaxjs-forms')
  })
})
