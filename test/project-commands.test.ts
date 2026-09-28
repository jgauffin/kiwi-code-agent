import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { packageScripts } from '../src/agent/permissions/package-scripts'
import { PermissionPolicy } from '../src/agent/permissions/permission-policy'
import { commandLines } from '../src/agent/permissions/permission-rules'
import type { ProjectCommands } from '../src/agent/permissions/project-commands'

const cwd = process.platform === 'win32' ? 'D:\\work\\repo' : '/work/repo'

const defined: ProjectCommands = { scripts: new Set(['build', 'test', 'typecheck']), verify: ['dotnet test "{project}" --nologo', 'npm test'] }

const policy = (project: ProjectCommands, rules: { allow?: string[]; deny?: string[] } = {}) =>
  new PermissionPolicy(cwd, () => ({ allow: rules.allow ?? [], deny: rules.deny ?? [] }), { project: () => project })

const asks = (command: string, project: ProjectCommands = defined, rules?: { allow?: string[]; deny?: string[] }) =>
  policy(project, rules).preToolUse({ toolName: 'Bash', input: { command }, toolUseId: 't' })

describe('commands the project defines for itself', () => {
  it('a_script_the_package_json_defines_runs_without_a_prompt', async () => {
    for (const command of ['npm run build', 'npm run build -- --flag', 'npm test', 'npm test -- test/a.test.ts -t "a_rule"', 'npm --silent run typecheck', 'pnpm build', 'yarn build', 'timeout 300 npm test']) {
      expect(await asks(command), command).toEqual({ allow: true })
    }
  })

  it('a_command_no_script_defines_still_prompts', async () => {
    // `install` and `publish` are the package manager's own, not the user's; `runner` is not `run`.
    for (const command of ['npm install', 'npm publish', 'npm run release', 'npm runner', 'yarn add lodash', 'npx vitest run']) {
      expect(await asks(command), command).toBeUndefined()
    }
  })

  it('a_script_run_against_another_package_prompts_because_its_scripts_are_not_the_ones_read', async () => {
    for (const command of ['npm --prefix web run build', 'npm run build --workspace=web', 'pnpm -F web build']) {
      expect(await asks(command), command).toBeUndefined()
    }
  })

  it('a_script_whose_output_is_redirected_into_a_file_prompts_for_the_file_it_writes', async () => {
    expect(await asks('npm run build > dist/log.txt')).toBeUndefined()
    // A redirect to nowhere writes nothing.
    expect(await asks('npm run build 2>&1')).toEqual({ allow: true })
  })

  it('a_test_command_verification_runs_itself_needs_no_prompt_when_a_session_narrows_it', async () => {
    for (const command of ['dotnet test src/Api/Api.csproj', 'dotnet test src/Api/Api.csproj --filter FullyQualifiedName~Orders', 'npm test']) {
      expect(await asks(command, { scripts: new Set(), verify: defined.verify }), command).toEqual({ allow: true })
    }
    // A different subcommand of the same tool is not the command the rule names.
    expect(await asks('dotnet build src/Api/Api.csproj', { scripts: new Set(), verify: defined.verify })).toBeUndefined()
  })

  it('a_deny_rule_beats_a_command_the_project_defines', async () => {
    expect(await asks('npm run build', defined, { deny: ['Bash(npm run build)'] })).toMatchObject({ deny: expect.stringContaining('npm run build') })
  })

  it('a_chain_with_one_command_the_project_does_not_define_still_prompts', async () => {
    expect(await asks('npm run build && ls')).toEqual({ allow: true })
    expect(await asks('npm run build && rm -rf dist')).toBeUndefined()
  })

  it('the_prompt_says_which_commands_the_project_itself_defines', () => {
    expect(commandLines('Bash', 'npm run build && dotnet test x.csproj && rm x', [], {}, defined)).toEqual([
      { text: 'npm run build', passes: 'package.json script' },
      { text: 'dotnet test x.csproj', passes: 'kiwiAgent.verify command' },
      { text: 'rm x', rule: 'Bash(rm:*)' },
    ])
  })

  it('a_project_that_defines_nothing_is_judged_by_its_rules_alone', async () => {
    expect(await asks('npm run build', { scripts: new Set(), verify: [] })).toBeUndefined()
    expect(commandLines('Bash', 'npm run build', [])).toEqual([{ text: 'npm run build', rule: 'Bash(npm run:*)' }])
  })
})

describe('packageScripts', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'scripts-'))
  })

  afterEach(() => rm(dir, { recursive: true, force: true }))

  it('a_script_added_after_the_session_started_is_honoured_on_the_next_call', async () => {
    await writeFile(join(dir, 'package.json'), JSON.stringify({ scripts: { test: 'vitest run' } }))
    expect([...packageScripts(dir)]).toEqual(['test'])
    await writeFile(join(dir, 'package.json'), JSON.stringify({ scripts: { test: 'vitest run', build: 'node esbuild.mjs' } }))
    expect([...packageScripts(dir)]).toEqual(['test', 'build'])
  })

  it('a_missing_or_malformed_package_json_defines_no_scripts_rather_than_failing_the_call', async () => {
    expect(packageScripts(dir).size).toBe(0)
    await writeFile(join(dir, 'package.json'), '{ not json')
    expect(packageScripts(dir).size).toBe(0)
    await writeFile(join(dir, 'package.json'), JSON.stringify({ scripts: 'nonsense' }))
    expect(packageScripts(dir).size).toBe(0)
  })
})
