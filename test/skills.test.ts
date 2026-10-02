import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BUNDLE_MARKER_FILE, indexSkills as indexUnder, indexSkillsDetailed, writeSkillsPlugin, type SkillBundleSource } from '../src/agent/skills/skill-index'
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

const owner: SkillBundleSource = { source: 'product', name: 'bug-repro', version: '1.0.0' }

/** A skill a bundle installed: the same layout as `skill()`, marked with the bundle that owns it. */
async function bundledSkill(folder: string, content: string, root = '.kiwi', base = dir, bundle: SkillBundleSource = owner): Promise<void> {
  await skill(folder, content, root, base)
  await writeFile(join(base, root, 'skills', folder, BUNDLE_MARKER_FILE), JSON.stringify(bundle))
}

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

  it('the_extensions_own_skills_are_listed_and_a_workspace_skill_of_the_same_name_replaces_them', async () => {
    const builtin = await mkdtemp(join(tmpdir(), 'skills-builtin-'))
    await mkdir(join(builtin, 'run-script'))
    await writeFile(join(builtin, 'run-script', 'SKILL.md'), '---\nname: run-script\ndescription: Built in.\n---\nbody')
    await mkdir(join(builtin, 'other'))
    await writeFile(join(builtin, 'other', 'SKILL.md'), '---\nname: other\ndescription: Also built in.\n---\nbody')
    await skill('run-script', '---\nname: run-script\ndescription: Ours.\n---\nbody')
    const skills = await indexUnder(dir, home, builtin)
    expect(skills.map((s) => [s.name, s.description])).toEqual([
      ['other', 'Also built in.'],
      ['run-script', 'Ours.'],
    ])
    await rm(builtin, { recursive: true, force: true })
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
    await skill('b', '---\nname: only-agent\ndescription: Agent only.\n---\nbody', '.kiwi')
    await skill('c', '---\nname: shared\ndescription: From .kiwi.\n---\nbody', '.kiwi')
    const skills = await indexSkills(dir)
    expect(skills.map((s) => [s.name, s.description])).toEqual([
      ['only-agent', 'Agent only.'],
      ['shared', 'From .kiwi.'],
    ])
  })

  it('user_skills_under_claude_and_agent_roots_are_indexed', async () => {
    await skill('a', '---\nname: user-claude\ndescription: From ~/.claude.\n---\nbody', '.claude', home)
    await skill('b', '---\nname: user-agent\ndescription: From ~/.kiwi.\n---\nbody', '.kiwi', home)
    const skills = await indexSkills(dir)
    expect(skills.map((s) => [s.name, s.description])).toEqual([
      ['user-agent', 'From ~/.kiwi.'],
      ['user-claude', 'From ~/.claude.'],
    ])
    expect(skills[1]!.dir).toBe(join(home, '.claude', 'skills', 'a'))
  })

  it('workspace_skill_replaces_user_skill_with_the_same_name', async () => {
    await skill('a', '---\nname: shared\ndescription: From the user.\n---\nbody', '.kiwi', home)
    await skill('b', '---\nname: shared\ndescription: From the workspace.\n---\nbody', '.claude')
    const skills = await indexSkills(dir)
    expect(skills.map((s) => [s.name, s.description])).toEqual([['shared', 'From the workspace.']])
  })

  it('a_folder_without_skill_md_and_a_workspace_without_skills_are_not_errors', async () => {
    expect(await indexSkills(dir)).toEqual([])
    await mkdir(join(dir, '.claude', 'skills', 'empty'), { recursive: true })
    expect(await indexSkills(dir)).toEqual([])
  })

  it('a_skill_a_bundle_installed_is_marked_with_its_source_bundle_name_and_version', async () => {
    await bundledSkill('bug-repro', '---\nname: bug-repro\ndescription: Reproduce a bug first.\n---\nbody')
    const skills = await indexSkills(dir)
    expect(skills[0]!.bundle).toEqual(owner)
  })

  it('a_hand_written_skill_carries_no_bundle_marking', async () => {
    await skill('forms', '---\nname: relaxjs-forms\ndescription: Building forms.\n---\nbody')
    const skills = await indexSkills(dir)
    expect(skills[0]!.bundle).toBeUndefined()
  })

  it('the_persons_own_skill_wins_a_name_clash_with_a_bundles_skill_even_from_a_root_that_normally_overrides', async () => {
    // The profile's own skill would normally lose to the workspace's under root order; a bundle's
    // skill at the workspace must not be the one that wins just because it comes from that root.
    await skill('a', '---\nname: shared\ndescription: From the person.\n---\nbody', '.kiwi', home)
    await bundledSkill('b', '---\nname: shared\ndescription: From a bundle.\n---\nbody', '.kiwi', dir)
    const skills = await indexSkills(dir)
    expect(skills.map((s) => [s.name, s.description, s.bundle])).toEqual([['shared', 'From the person.', undefined]])
  })

  it('a_bundle_skill_that_lost_a_name_clash_is_named_as_not_applied', async () => {
    await skill('a', '---\nname: shared\ndescription: From the person.\n---\nbody', '.kiwi', home)
    await bundledSkill('b', '---\nname: shared\ndescription: From a bundle.\n---\nbody', '.kiwi', dir)
    const { shadowed } = await indexSkillsDetailed(dir, home)
    expect(shadowed).toEqual([{ name: 'shared', bundle: owner }])
  })

  it('two_bundle_skills_of_the_same_name_are_not_reported_as_shadowed_the_later_root_still_wins', async () => {
    await bundledSkill('a', '---\nname: shared\ndescription: Profile bundle.\n---\nbody', '.kiwi', home, { ...owner, version: '1.0.0' })
    await bundledSkill('b', '---\nname: shared\ndescription: Workspace bundle.\n---\nbody', '.kiwi', dir, { ...owner, version: '2.0.0' })
    const { skills, shadowed } = await indexSkillsDetailed(dir, home)
    expect(shadowed).toEqual([])
    expect(skills.map((s) => [s.description, s.bundle?.version])).toEqual([['Workspace bundle.', '2.0.0']])
  })
})

describe('Skill tool', () => {
  it('description_carries_the_index_so_the_model_can_pick_without_a_lookup', async () => {
    await skill('forms', '---\nname: relaxjs-forms\ndescription: Building forms.\n---\nbody')
    const definition = toDefinition(skillTool(await indexSkills(dir)))
    expect(definition.name).toBe('Skill')
    expect(definition.description).toContain('- relaxjs-forms: Building forms.')
  })

  it('loads_the_body_without_frontmatter_for_the_model_only_and_names_the_folder_for_relative_paths', async () => {
    await skill('forms', '---\nname: relaxjs-forms\ndescription: Building forms.\n---\n# Forms\n\nSee [ref](reference.md).\n')
    const tool = skillTool(await indexSkills(dir))
    const result = await tool.execute({ name: 'relaxjs-forms' }, ctx)
    expect(result.isError).toBe(false)
    expect(result.text).toContain(join(dir, '.claude', 'skills', 'forms'))
    expect(result.text).not.toContain('# Forms')
    expect(result.context).toContain('# Forms\n\nSee [ref](reference.md).')
    expect(result.context).not.toContain('description:')
    expect(tool.readOnly).toBe(true)
  })

  it('unknown_skill_is_a_tool_error_naming_the_available_ones', async () => {
    await skill('forms', '---\nname: relaxjs-forms\ndescription: Building forms.\n---\nbody')
    const result = await skillTool(await indexSkills(dir)).execute({ name: 'nope' }, ctx)
    expect(result.isError).toBe(true)
    expect(result.text).toContain('relaxjs-forms')
  })

  it('a_bundled_skill_is_offered_and_loads_like_any_other', async () => {
    await bundledSkill('bug-repro', '---\nname: bug-repro\ndescription: Reproduce a bug first.\n---\nWrite the failing test first.')
    const skills = await indexSkills(dir)
    const definition = toDefinition(skillTool(skills))
    expect(definition.description).toContain('- bug-repro: Reproduce a bug first.')
    const result = await skillTool(skills).execute({ name: 'bug-repro' }, ctx)
    expect(result.isError).toBe(false)
    expect(result.context).toContain('Write the failing test first.')
  })
})

describe('writeSkillsPlugin', () => {
  it('mirrors_every_resolved_skill_including_a_bundled_one_under_its_own_name', async () => {
    await skill('forms', '---\nname: relaxjs-forms\ndescription: Building forms.\n---\nbody')
    await bundledSkill('bug-repro', '---\nname: bug-repro\ndescription: Reproduce a bug first.\n---\nWrite the failing test first.')
    const pluginDir = join(dir, 'plugin')
    await writeSkillsPlugin(pluginDir, await indexSkills(dir))
    expect(await readFile(join(pluginDir, 'skills', 'relaxjs-forms', 'SKILL.md'), 'utf8')).toContain('Building forms.')
    expect(await readFile(join(pluginDir, 'skills', 'bug-repro', 'SKILL.md'), 'utf8')).toContain('Write the failing test first.')
  })

  it('drops_a_skill_removed_since_the_last_build_rather_than_leaving_it_behind', async () => {
    await skill('a', '---\nname: gone\ndescription: Removed since.\n---\nbody')
    const pluginDir = join(dir, 'plugin')
    await writeSkillsPlugin(pluginDir, await indexSkills(dir))
    await rm(join(dir, '.claude', 'skills', 'a'), { recursive: true, force: true })
    await writeSkillsPlugin(pluginDir, await indexSkills(dir))
    await expect(readFile(join(pluginDir, 'skills', 'gone', 'SKILL.md'), 'utf8')).rejects.toThrow()
  })
})
