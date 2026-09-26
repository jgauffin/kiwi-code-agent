import { describe, expect, it } from 'vitest'
import { isReadOnlyCommand } from '../src/agent/permissions/read-only-commands'
import { PermissionPolicy, type PermissionRules } from '../src/agent/permissions/permission-policy'
import { commandLines, projectRuleFor, ruleLabel } from '../src/agent/permissions/permission-rules'
import { WriteAllowance } from '../src/agent/permissions/write-allowance'
import { composeHooks, type SessionHooks } from '../src/agent/session/hooks'
import { ASK_USER_TOOL } from '../src/agent/openai-session/tools/ask-user'
import { BLIND_PLAN_TOOLS, blindPlanPrompt } from '../src/agent/phases/blind-plan'
import { IMPLEMENT_TOOLS, implementPrompt } from '../src/agent/phases/implement'
import { RECONCILE_TOOLS } from '../src/agent/phases/reconcile'

const cwd = process.platform === 'win32' ? 'D:\\work\\repo' : '/work/repo'

describe('isReadOnlyCommand', () => {
  it('everyday_inspection_commands_are_read_only', () => {
    for (const c of ['ls -la src', 'cat package.json | head -20', 'grep -rn foo src && wc -l x', 'git status', 'git log --oneline -5', 'git diff HEAD~1', 'rg TODO', 'pwd', 'find . -name "*.ts"', 'sed -n 1,10p a.ts', 'dotnet --version', 'npm ls'])
      expect(isReadOnlyCommand(c), c).toBe(true)
  })

  it('shell_structure_and_builtins_that_touch_only_shell_state_are_read_only_where_their_commands_are', () => {
    for (const c of ['if [ -f x ]; then cat x; fi', 'for f in *.ts; do wc -l $f; done', 'CI=1 git status', 'X=1', '[[ -d src ]] && ls src', 'set -e; export A=1; ls', 'cat <<EOF\nrm -rf /\nEOF'])
      expect(isReadOnlyCommand(c), c).toBe(true)
    for (const c of ['if [ -f x ]; then rm x; fi', 'for f in *.ts; do rm $f; done', 'eval "$x"', 'source ./env.sh', 'f() { rm x; }'])
      expect(isReadOnlyCommand(c), c).toBe(false)
  })

  it('anything_that_writes_runs_code_or_mutates_git_is_not', () => {
    for (const c of ['rm x', 'npm test', 'git commit -m x', 'git branch -D x', 'echo hi > f', 'find . -delete', 'find . -exec rm {} \\;', 'sed -i s/a/b/ f', 'ls; rm x', 'cat $(ls)', 'bash -c ls', 'xargs rm', 'node -e 1'])
      expect(isReadOnlyCommand(c), c).toBe(false)
  })
})

describe('commandLines', () => {
  it('each_mutating_command_is_offered_the_rule_of_its_command_and_subcommand_and_a_read_only_one_passes', () => {
    expect(commandLines('Bash', 'npm run build && npx vitest run && ls -la', [])).toEqual([
      { text: 'npm run build', rule: 'Bash(npm run:*)' },
      { text: 'npx vitest run', rule: 'Bash(npx vitest:*)' },
      { text: 'ls -la', passes: 'read-only' },
    ])
    expect(commandLines('Bash', 'git commit -m "x && y"', [])).toEqual([{ text: 'git commit -m "x && y"', rule: 'Bash(git commit:*)' }])
    expect(commandLines('Bash', 'rm -rf dist', [])).toEqual([{ text: 'rm -rf dist', rule: 'Bash(rm:*)' }])
  })

  it('a_command_an_allow_rule_covers_passes_by_that_rule', () => {
    expect(commandLines('Bash', 'npm run build && rm x', ['Bash(npm run:*)', 'Edit(src/**)'])).toEqual([
      { text: 'npm run build', passes: 'Bash(npm run:*)' },
      { text: 'rm x', rule: 'Bash(rm:*)' },
    ])
  })

  it('the_rule_offered_for_a_command_run_by_path_covers_that_command_next_time', () => {
    for (const command of ['./build.cmd test', '.\\build.cmd test', 'node_modules/.bin/vitest run']) {
      const [line] = commandLines('Bash', command, [])
      expect(line?.rule, command).toBeDefined()
      expect(commandLines('Bash', command, [line!.rule!]), command).toEqual([{ text: command, passes: line!.rule }])
    }
  })

  it('powershell_is_judged_like_bash_under_rules_of_its_own_name', () => {
    expect(commandLines('PowerShell', 'npm run build; git status', ['Bash(npm run:*)'])).toEqual([
      { text: 'npm run build', rule: 'PowerShell(npm run:*)' },
      { text: 'git status', passes: 'read-only' },
    ])
    expect(commandLines('PowerShell', 'npm run build', ['PowerShell(npm run:*)'])).toEqual([{ text: 'npm run build', passes: 'PowerShell(npm run:*)' }])
  })

  it('a_substitution_hides_a_command_so_no_line_passes_and_none_can_be_remembered', () => {
    expect(commandLines('Bash', 'ls && echo $(rm x)', ['Bash(ls:*)'])).toEqual([{ text: 'ls' }, { text: 'echo $(rm x)' }])
  })

  it('other_tools_are_remembered_by_tool_and_a_file_write_never_for_the_project', () => {
    expect(projectRuleFor('WebFetch')).toBe('WebFetch')
    for (const tool of ['Write', 'Edit', 'MultiEdit', 'NotebookEdit']) expect(projectRuleFor(tool), tool).toBeUndefined()
  })

  it('the_label_says_what_will_be_allowed', () => {
    expect(ruleLabel('Bash(npm run:*)')).toBe('npm run')
    expect(ruleLabel('Edit')).toBe('Edit')
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
    expect(await use(p, 'PowerShell', { command: 'git status; ls' })).toEqual({ allow: true })
    expect(await use(p, 'PowerShell', { command: 'npm test' })).toBeUndefined()
    expect(await use(policy({ allow: ['Bash(npm test)'] }), 'PowerShell', { command: 'npm test' })).toBeUndefined()
    expect(await use(policy({ allow: ['PowerShell(npm test)'] }), 'PowerShell', { command: 'npm test' })).toEqual({ allow: true })
  })

  it('cd_inside_the_project_is_read_only_and_cd_elsewhere_prompts', async () => {
    const p = policy({})
    expect(await use(p, 'Bash', { command: `cd "${cwd.replace(/\\/g, '/')}" && git log --oneline -15 && echo "---" && git status --short | head -30` })).toEqual({ allow: true })
    expect(await use(p, 'Bash', { command: 'cd src && ls' })).toEqual({ allow: true })
    expect(await use(p, 'Bash', { command: 'cd .. && ls' })).toBeUndefined()
    expect(await use(p, 'Bash', { command: 'cd && ls' })).toBeUndefined()
    expect(commandLines('Bash', 'cd .. && ls', [])).toEqual([{ text: 'cd ..', rule: 'Bash(cd:*)' }, { text: 'ls', passes: 'read-only' }])
  })

  it('a_shell_prompt_is_decorated_with_its_lines_under_the_rules_in_force_and_nothing_else_is_touched', () => {
    let allow: string[] = []
    const p = new PermissionPolicy(cwd, () => ({ allow, deny: [] }))
    const request = { type: 'permission_request' as const, requestId: 'r', toolName: 'Bash', input: { command: 'npm run build && git status' } }
    expect(p.decorate(request)).toEqual({ ...request, commands: [{ text: 'npm run build', rule: 'Bash(npm run:*)' }, { text: 'git status', passes: 'read-only' }] })
    // A rule allowed for the session earlier is read on the next prompt.
    allow = ['Bash(npm run:*)']
    expect(p.decorate(request)).toMatchObject({ commands: [{ text: 'npm run build', passes: 'Bash(npm run:*)' }, { text: 'git status', passes: 'read-only' }] })
    const other = { ...request, toolName: 'WebFetch', input: { url: 'x' } }
    expect(p.decorate(other)).toBe(other)
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

  it('a_shell_call_passes_when_the_rules_together_cover_every_command_not_only_when_one_rule_does', async () => {
    const p = policy({ allow: ['Bash(npm install:*)', 'Bash(node:*)'] })
    expect(await use(p, 'Bash', { command: 'npm install 2>&1 | tail -6\nnode -p "1" 2>&1\ngrep -ril x .' })).toEqual({ allow: true })
    expect(await use(p, 'Bash', { command: 'npm install && node -p "1" && rm x' })).toBeUndefined()
    // What the prompt shows line by line and what lets the call through are the same judgement.
    const lines = commandLines('Bash', 'npm install && node -p "1" && ls', ['Bash(npm install:*)', 'Bash(node:*)'])
    expect(lines.every((l) => l.passes)).toBe(true)
  })

  it('an_exact_bash_rule_matches_only_that_command', async () => {
    const p = policy({ allow: ['Bash(npm test)'] })
    expect(await use(p, 'Bash', { command: 'npm test' })).toEqual({ allow: true })
    expect(await use(p, 'Bash', { command: 'npm test -- --watch' })).toBeUndefined()
  })

  it('an_mcp_tool_asks_unless_a_rule_names_it_or_its_whole_server', async () => {
    expect(await use(policy({}), 'mcp__docs-server__json_query', {})).toBeUndefined()
    expect(await use(policy({ allow: ['mcp__docs-server__json_query'] }), 'mcp__docs-server__json_query', {})).toEqual({ allow: true })
    const server = policy({ allow: ['mcp__docs-server__*'] })
    expect(await use(server, 'mcp__docs-server__json_query', {})).toEqual({ allow: true })
    expect(await use(server, 'mcp__docs-server__read_doc_file', {})).toEqual({ allow: true })
    expect(await use(server, 'mcp__docs-server-2__json_query', {})).toBeUndefined()
    expect(await use(server, 'mcp__other__json_query', {})).toBeUndefined()
    expect(await use(policy({ deny: ['mcp__docs-server__*'], allow: ['mcp__docs-server__json_query'] }), 'mcp__docs-server__json_query', {})).toMatchObject({
      deny: expect.stringContaining('mcp__docs-server__*'),
    })
    expect(projectRuleFor('mcp__docs-server__json_query')).toBe('mcp__docs-server__json_query')
    expect(ruleLabel('mcp__docs-server__*')).toBe('mcp__docs-server__*')
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

  it('asking_the_user_a_question_is_never_put_to_a_permission_prompt_first', async () => {
    expect(await use(policy({}), ASK_USER_TOOL, { questions: [{ header: 'Storage', question: 'Where?' }] })).toEqual({ allow: true })
  })
})

describe('which sessions may ask', () => {
  it('a_session_whose_output_the_user_never_sees_is_not_offered_the_question_tool', () => {
    // The mapping run has no transcript of its own: it reports what it could not settle in its findings.
    expect(RECONCILE_TOOLS).not.toContain(ASK_USER_TOOL)
    expect(BLIND_PLAN_TOOLS).toContain(ASK_USER_TOOL)
    expect(IMPLEMENT_TOOLS).toContain(ASK_USER_TOOL)
  })

  it('a_session_that_needs_a_ruling_asks_through_the_tool_instead_of_stopping_or_blocking', () => {
    const plan = blindPlanPrompt('Order cancellation', cwd)
    expect(plan).toContain(ASK_USER_TOOL)
    expect(plan).not.toContain('do not invent: ask, and stop')
    // The direction checkpoint is the user steering, not the plan asking; it stays.
    expect(plan).toContain('Write nothing until the user says go')

    const implement = implementPrompt('Order cancellation', cwd)
    expect(implement).toContain(ASK_USER_TOOL)
    expect(implement).not.toContain('When nothing more can be done without the user, stop')
    expect(implement).toContain('for a reason no answer would remove')
  })
})

describe('WriteAllowance', () => {
  const use = (h: SessionHooks, toolName: string, input: unknown) => h.preToolUse!({ toolName, input, toolUseId: 't' })

  it('file_writes_pass_without_a_prompt_while_the_session_switch_is_on', async () => {
    let on = false
    const allowance = new WriteAllowance(cwd, () => on)
    expect(await use(allowance, 'Edit', { file_path: 'src/a.ts' })).toBeUndefined()
    on = true
    for (const tool of ['Write', 'Edit', 'MultiEdit', 'NotebookEdit']) expect(await use(allowance, tool, { file_path: 'src/a.ts' }), tool).toEqual({ allow: true })
    expect(await use(allowance, 'Bash', { command: 'echo hi > f' })).toBeUndefined()
  })

  it('a_move_or_copy_passes_under_the_switch_only_when_both_ends_are_inside_the_project', async () => {
    let on = false
    const allowance = new WriteAllowance(cwd, () => on)
    const outside = process.platform === 'win32' ? 'E:\\elsewhere\\a.ts' : '/elsewhere/a.ts'
    expect(await use(allowance, 'Move', { source: 'src/a.ts', destination: 'lib/a.ts' })).toBeUndefined()
    on = true
    for (const tool of ['Move', 'Copy']) {
      expect(await use(allowance, tool, { source: 'src/a.ts', destination: `${cwd}/lib/a.ts` }), tool).toEqual({ allow: true })
      expect(await use(allowance, tool, { source: 'src/a.ts', destination: '../other/a.ts' }), tool).toBeUndefined()
      expect(await use(allowance, tool, { source: outside, destination: 'src/a.ts' }), tool).toBeUndefined()
      expect(await use(allowance, tool, { source: '.', destination: 'copy' }), tool).toBeUndefined()
    }
  })

  it('a_move_is_denied_when_a_deny_rule_names_either_end_and_allowed_only_when_a_rule_covers_both', async () => {
    const p = new PermissionPolicy(cwd, () => ({ allow: ['Move(src/**)'], deny: ['Move(**/.env)'] }))
    expect(await use(p, 'Move', { source: 'src/a.ts', destination: 'src/b.ts' })).toEqual({ allow: true })
    expect(await use(p, 'Move', { source: 'src/a.ts', destination: 'lib/a.ts' })).toBeUndefined()
    expect(await use(p, 'Move', { source: 'src/a.ts', destination: 'config/.env' })).toMatchObject({ deny: expect.stringContaining('Move(**/.env)') })
    expect(projectRuleFor('Move')).toBeUndefined()
  })

  it('a_deny_rule_still_blocks_a_write_the_switch_would_allow', async () => {
    const policy = new PermissionPolicy(cwd, () => ({ allow: [], deny: ['Write(**/.env)'] }))
    const hooks = composeHooks(policy, new WriteAllowance(cwd, () => true))
    expect(await use(hooks, 'Write', { file_path: 'config/.env' })).toMatchObject({ deny: expect.stringContaining('Write(**/.env)') })
    expect(await use(hooks, 'Write', { file_path: 'src/a.ts' })).toEqual({ allow: true })
  })
})
