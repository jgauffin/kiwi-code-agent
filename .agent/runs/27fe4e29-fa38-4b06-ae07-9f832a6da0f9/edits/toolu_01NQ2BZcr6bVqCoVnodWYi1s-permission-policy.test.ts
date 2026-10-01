import { describe, expect, it } from 'vitest'
import { isReadOnlyCommand } from '../src/agent/permissions/read-only-commands'
import { PermissionPolicy, type PermissionRules } from '../src/agent/permissions/permission-policy'
import { projectRulesFor, ruleLabel } from '../src/agent/permissions/permission-rules'
import { WriteAllowance } from '../src/agent/permissions/write-allowance'
import { composeHooks, type SessionHooks } from '../src/agent/session/hooks'

const cwd = process.platform === 'win32' ? 'D:\\work\\repo' : '/work/repo'

describe('isReadOnlyCommand', () => {
  it('everyday_inspection_commands_are_read_only', () => {
    for (const c of ['ls -la src', 'cat package.json | head -20', 'grep -rn foo src && wc -l x', 'git status', 'git log --oneline -5', 'git diff HEAD~1', 'rg TODO', 'pwd', 'find . -name "*.ts"', 'sed -n 1,10p a.ts', 'dotnet --version', 'npm ls'])
      expect(isReadOnlyCommand(c), c).toBe(true)
  })

  it('anything_that_writes_runs_code_or_mutates_git_is_not', () => {
    for (const c of ['rm x', 'npm test', 'git commit -m x', 'git branch -D x', 'echo hi > f', 'find . -delete', 'find . -exec rm {} \\;', 'sed -i s/a/b/ f', 'ls; rm x', 'cat $(ls)', 'bash -c ls', 'xargs rm', 'node -e 1'])
      expect(isReadOnlyCommand(c), c).toBe(false)
  })
})

describe('projectRulesFor', () => {
  it('a_bash_command_is_remembered_by_the_command_and_subcommand_of_each_mutating_segment', () => {
    expect(projectRulesFor('Bash', { command: 'npm run build && npx vitest run && ls' })).toEqual(['Bash(npm run:*)', 'Bash(npx vitest:*)'])
    expect(projectRulesFor('Bash', { command: 'git commit -m x' })).toEqual(['Bash(git commit:*)'])
    expect(projectRulesFor('Bash', { command: 'rm -rf dist' })).toEqual(['Bash(rm:*)'])
  })

  it('other_tools_are_remembered_by_tool_for_the_whole_project', () => {
    expect(projectRulesFor('WebFetch', { url: 'x' })).toEqual(['WebFetch'])
  })

  it('a_file_write_is_never_remembered_for_the_project', () => {
    for (const tool of ['Write', 'Edit', 'MultiEdit', 'NotebookEdit']) expect(projectRulesFor(tool, { file_path: 'src/a.ts' }), tool).toEqual([])
  })

  it('the_label_says_what_will_be_allowed', () => {
    expect(ruleLabel(['Bash(npm run:*)', 'Bash(npx vitest:*)'])).toBe('npm run, npx vitest')
    expect(ruleLabel(['Edit'])).toBe('Edit')
  })
})

describe('PermissionPolicy', () => {
  const policy = (rules: Partial<PermissionRules>) => new PermissionPolicy(cwd, () => ({ allow: [], deny: [], ...rules }))
  const use = (p: PermissionPolicy, toolName: string, input: unknown) => p.preToolUse({ toolName, input, toolUseId: 't' })

  it('read_only_tools_and_read_only_commands_pass_without_a_prompt', async () => {
    const p = policy({})
    expect(await use(p, 'Read', { file_path: 'src/a.ts' })).toEqual({ allow: true })
    expect(await use(p, 'Grep', { pattern: 'x' })).toEqual({ allow: true })
    expect(await use(p, 'Bash', { command: 'git status && ls' })).toEqual({ allow: true })
  })

  it('cd_inside_the_project_is_read_only_and_cd_elsewhere_prompts', async () => {
    const p = policy({})
    expect(await use(p, 'Bash', { command: `cd "${cwd.replace(/\\/g, '/')}" && git log --oneline -15 && echo "---" && git status --short | head -30` })).toEqual({ allow: true })
    expect(await use(p, 'Bash', { command: 'cd src && ls' })).toEqual({ allow: true })
    expect(await use(p, 'Bash', { command: 'cd .. && ls' })).toBeUndefined()
    expect(await use(p, 'Bash', { command: 'cd && ls' })).toBeUndefined()
    expect(projectRulesFor('Bash', { command: 'cd .. && ls' })).toEqual(['Bash(cd:*)'])
  })

  it('mutating_calls_prompt_unless_a_project_rule_covers_every_segment', async () => {
    expect(await use(policy({}), 'Bash', { command: 'npm test' })).toBeUndefined()
    expect(await use(policy({}), 'Edit', { file_path: 'src/a.ts' })).toBeUndefined()
    const p = policy({ allow: ['Bash(npm run:*)', 'Edit(src/**)'] })
    expect(await use(p, 'Bash', { command: 'npm run build && ls' })).toEqual({ allow: true })
    expect(await use(p, 'Bash', { command: 'npm run build && rm x' })).toBeUndefined()
    expect(await use(p, 'Bash', { command: 'npm run build' })).toEqual({ allow: true })
    expect(await use(p, 'Bash', { command: 'npm runner' })).toBeUndefined()
    expect(await use(p, 'Edit', { file_path: `${cwd}/src/deep/a.ts` })).toEqual({ allow: true })
    expect(await use(p, 'Edit', { file_path: 'test/a.ts' })).toBeUndefined()
    expect(await use(policy({ allow: ['Write'] }), 'Write', { file_path: 'anything' })).toEqual({ allow: true })
  })

  it('an_exact_bash_rule_matches_only_that_command', async () => {
    const p = policy({ allow: ['Bash(npm test)'] })
    expect(await use(p, 'Bash', { command: 'npm test' })).toEqual({ allow: true })
    expect(await use(p, 'Bash', { command: 'npm test -- --watch' })).toBeUndefined()
  })

  it('deny_rules_win_over_read_only_and_allow_rules_and_name_the_rule', async () => {
    const p = policy({ allow: ['Bash'], deny: ['Read(**/.env)', 'Bash(curl:*)'] })
    expect(await use(p, 'Read', { file_path: 'config/.env' })).toMatchObject({ deny: expect.stringContaining('Read(**/.env)') })
    expect(await use(p, 'Bash', { command: 'ls && curl http://x' })).toMatchObject({ deny: expect.stringContaining('Bash(curl:*)') })
    expect(await use(p, 'Bash', { command: 'ls' })).toEqual({ allow: true })
  })

  it('command_substitution_always_prompts_because_the_inner_command_is_unknown', async () => {
    expect(await use(policy({ allow: ['Bash'] }), 'Bash', { command: 'echo $(ls)' })).toBeUndefined()
  })
})

describe('WriteAllowance', () => {
  const use = (h: SessionHooks, toolName: string, input: unknown) => h.preToolUse!({ toolName, input, toolUseId: 't' })

  it('file_writes_pass_without_a_prompt_while_the_session_switch_is_on', async () => {
    let on = false
    const allowance = new WriteAllowance(() => on)
    expect(await use(allowance, 'Edit', { file_path: 'src/a.ts' })).toBeUndefined()
    on = true
    for (const tool of ['Write', 'Edit', 'MultiEdit', 'NotebookEdit']) expect(await use(allowance, tool, { file_path: 'src/a.ts' }), tool).toEqual({ allow: true })
    expect(await use(allowance, 'Bash', { command: 'echo hi > f' })).toBeUndefined()
  })

  it('a_deny_rule_still_blocks_a_write_the_switch_would_allow', async () => {
    const policy = new PermissionPolicy(cwd, () => ({ allow: [], deny: ['Write(**/.env)'] }))
    const hooks = composeHooks(policy, new WriteAllowance(() => true))
    expect(await use(hooks, 'Write', { file_path: 'config/.env' })).toMatchObject({ deny: expect.stringContaining('Write(**/.env)') })
    expect(await use(hooks, 'Write', { file_path: 'src/a.ts' })).toEqual({ allow: true })
  })
})
