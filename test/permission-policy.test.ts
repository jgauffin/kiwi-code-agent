import { describe, expect, it } from 'vitest'
import { isReadOnlyCommand } from '../src/agent/permissions/read-only-commands'
import { PermissionPolicy, type PermissionRules } from '../src/agent/permissions/permission-policy'
import { commandLines, projectRuleFor, ruleLabel } from '../src/agent/permissions/permission-rules'
import { readOnlyTools } from '../src/agent/permissions/tool-classes'
import type { SessionHooks } from '../src/agent/session/hooks'
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
    for (const c of ['rm x', 'npm test', 'git commit -m x', 'git branch -D x', 'echo hi > f', 'find . -delete', 'find . -exec rm {} \\;', 'sed -i s/a/b/ f', 'ls; rm x', 'bash -c ls', 'xargs rm', 'node -e 1'])
      expect(isReadOnlyCommand(c), c).toBe(false)
  })

  it('a_command_that_writes_or_runs_code_given_some_arguments_is_read_only_only_without_them', () => {
    for (const c of [
      'sort -n x', 'sort -k 2 -t , x', 'uniq -c x', 'uniq -f 2 x', 'tree -L 2 src', 'date +%Y', 'date -d yesterday', 'hostname', 'rg -n foo', 'ag foo',
      'yq .a x.yaml', 'yq -o=json .a x', 'file x', 'git log --oneline', 'git grep -n foo', 'go env GOPATH', 'find . -name x -print',
    ])
      expect(isReadOnlyCommand(c), c).toBe(true)
    for (const c of [
      'sort -o out x', 'sort -no out x', 'sort --output=out x', 'sort --compress-program=sh x', 'uniq in out', 'uniq -c in out', 'tree -o out', 'tree -R -H . src',
      'date -s 2020-01-01', 'date --set=now', 'date 0101000020', 'hostname evil', 'rg --pre ./run.sh foo', 'rg --pre=sh foo', 'ag --pager=sh foo',
      'yq -i .a=1 x', 'yq -Pi .a=1 x', 'yq --inplace .a=1 x', 'yq -s .name x', 'file -C -m magic', 'git log --output=f', 'git diff --output f', 'git show --output=f',
      'git grep -O foo', 'git grep --open-files-in-pager=vim foo', 'go env -w GOFLAGS=x', 'go env -u GOFLAGS', 'find . -fprintf out %p', 'find . -fls out', 'find . -fprint0 out',
    ])
      expect(isReadOnlyCommand(c), c).toBe(false)
  })

  it('a_substitution_is_judged_by_the_command_it_holds_and_not_by_being_one', () => {
    for (const c of ['cat $(ls)', 'echo "x $(echo y | cut -c1-3)"', 'diff <(ls a) <(ls b)', 'X=$(git status) ls', 'echo $(( $(ls | wc -l) + 1 ))'])
      expect(isReadOnlyCommand(c), c).toBe(true)
    for (const c of ['echo $(rm x)', 'cat `rm x`', 'echo ${x:-$(rm y)}', '(( $(rm y) ))', 'cat $(ls > out)'])
      expect(isReadOnlyCommand(c), c).toBe(false)
  })

  it('a_command_word_a_substitution_supplies_is_not_read_only_whatever_it_prints', () => {
    for (const c of ['$(which ls)', 'timeout 30 $(which ls)', '`which ls` -la'])
      expect(isReadOnlyCommand(c), c).toBe(false)
    // Quoted, it is text the command reads, not a command the shell runs.
    expect(isReadOnlyCommand("echo '$(rm x)'")).toBe(true)
  })
})

describe('commands that wrap another command', () => {
  it('a_wrapper_is_judged_by_what_it_runs_not_by_its_own_name', () => {
    for (const c of ['timeout 30 ls -la', 'timeout -k 5 30 cat x', 'timeout --foreground 1m git status', 'nohup ls', 'env FOO=1 cat x', 'env -u PATH ls', 'env -i FOO=1 BAR=2 grep -rn foo src'])
      expect(isReadOnlyCommand(c), c).toBe(true)
    for (const c of ['timeout 30 rm -rf build', 'timeout -s KILL 30 npm test', 'nohup rm x', 'env FOO=1 rm -rf build', 'env -u PATH git commit -m x', 'timeout 30 env FOO=1 rm x'])
      expect(isReadOnlyCommand(c), c).toBe(false)
  })

  it('a_wrapper_with_nothing_to_run_only_reports_and_one_that_cannot_be_read_is_presumed_to_mutate', () => {
    // Bare `env` prints the environment; `env -S` splits a string of its own into a command.
    for (const c of ['env', 'env FOO=1']) expect(isReadOnlyCommand(c), c).toBe(true)
    for (const c of ['env -S "rm -rf x"', 'env --unknown-flag ls', 'timeout --verbose']) expect(isReadOnlyCommand(c), c).toBe(false)
  })

  it('xargs_passes_only_a_command_that_no_argument_from_its_input_can_turn_into_a_write', () => {
    for (const c of ['ls | xargs grep -n foo', 'find . -name "*.ts" | xargs wc -l', 'ls | xargs -0 cat', 'ls | xargs -n1 -P4 head -5', 'ls | xargs -I{} cat {}', 'ls | xargs -I {} cat {}', 'ls | xargs --max-args=2 cat', 'ls | xargs', 'ls | xargs timeout 5 cat'])
      expect(isReadOnlyCommand(c), c).toBe(true)
    // `echo -delete | xargs find .` deletes, and `echo -i | xargs sed s/a/b/ f` edits in place.
    for (const c of ['ls | xargs rm', 'ls | xargs sed -n 1p', 'ls | xargs find .', 'ls | xargs sort', 'ls | xargs git log', 'ls | xargs cd', 'ls | xargs -I{} sh -c "cat {}"', 'ls | xargs --unknown cat', 'ls | xargs timeout 5 rm', 'timeout 5 xargs sort'])
      expect(isReadOnlyCommand(c), c).toBe(false)
  })

  it('an_exact_rule_does_not_allow_a_command_xargs_may_hand_more_arguments_but_still_denies_it', async () => {
    const ruled = (rules: Partial<PermissionRules>, command: string) =>
      new PermissionPolicy(cwd, () => ({ allow: [], deny: [], ...rules })).preToolUse({ toolName: 'Bash', input: { command }, toolUseId: 't' })
    expect(await ruled({ allow: ['Bash(git push origin main)'] }, 'git push origin main')).toEqual({ allow: true })
    expect(await ruled({ allow: ['Bash(git push origin main)'] }, 'echo --force | xargs git push origin main')).toBeUndefined()
    expect(await ruled({ allow: ['Bash(npm run:*)'] }, 'ls | xargs npm run lint')).toEqual({ allow: true })
    expect(await ruled({ allow: ['Bash'], deny: ['Bash(npm publish)'] }, 'echo | xargs npm publish')).toMatchObject({ deny: expect.stringContaining('Bash(npm publish)') })
    expect(await ruled({ allow: ['Bash'], deny: ['Bash(rm:*)'] }, 'ls | xargs rm')).toMatchObject({ deny: expect.stringContaining('Bash(rm:*)') })
  })

  it('a_rule_covers_the_command_it_names_however_it_is_wrapped', async () => {
    const ruled = (rules: Partial<PermissionRules>, command: string) =>
      new PermissionPolicy(cwd, () => ({ allow: [], deny: [], ...rules })).preToolUse({ toolName: 'Bash', input: { command }, toolUseId: 't' })
    expect(await ruled({ allow: ['Bash(npm test)'] }, 'timeout 300 npm test')).toEqual({ allow: true })
    // And a deny is not walked past by wrapping what it blocks.
    expect(await ruled({ deny: ['Bash(rm:*)'] }, 'env FOO=1 rm -rf build')).toMatchObject({ deny: expect.stringContaining('Bash(rm:*)') })
    expect(await ruled({ deny: ['Bash(rm:*)'] }, 'timeout 5 rm -rf build')).toMatchObject({ deny: expect.stringContaining('Bash(rm:*)') })
  })

  it('the_rule_offered_for_a_wrapped_command_names_the_command_not_the_wrapper', () => {
    // A remembered `Bash(timeout:*)` would cover everything timeout is ever pointed at.
    expect(commandLines('Bash', 'timeout 300 npm run build', [])).toEqual([{ text: 'timeout 300 npm run build', rule: 'Bash(npm run:*)' }])
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

  it('a_command_a_substitution_holds_is_a_line_of_its_own', () => {
    expect(commandLines('Bash', 'ls && echo $(rm x)', ['Bash(ls:*)'])).toEqual([
      { text: 'ls', passes: 'read-only' },
      { text: 'echo $(rm x)', passes: 'read-only' },
      { text: 'rm x', rule: 'Bash(rm:*)' },
    ])
  })

  it('a_line_whose_command_word_is_a_substitution_passes_nothing_and_is_offered_no_rule', () => {
    expect(commandLines('Bash', '$(which rm) -rf x', ['Bash(rm:*)'])).toEqual([{ text: '$(which rm) -rf x' }, { text: 'which rm', passes: 'read-only' }])
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

/** The tools of a session, as the policy learns which of them only look. */
const readOnly = readOnlyTools(() => [
  { name: 'MarkdownSearch', readOnly: true },
  { name: ASK_USER_TOOL, readOnly: true },
  { name: 'Write', readOnly: false },
])

describe('PermissionPolicy', () => {
  const policy = (rules: Partial<PermissionRules>) => new PermissionPolicy(cwd, () => ({ allow: [], deny: [], ...rules }), { readOnly })
  const use = (p: PermissionPolicy, toolName: string, input: unknown) => p.preToolUse({ toolName, input, toolUseId: 't' })

  it('read_only_tools_and_read_only_commands_pass_without_a_prompt', async () => {
    const p = policy({})
    expect(await use(p, 'Read', { file_path: 'src/a.ts' })).toEqual({ allow: true })
    expect(await use(p, 'Grep', { pattern: 'x' })).toEqual({ allow: true })
    expect(await use(p, 'MarkdownSearch', { query: 'x', path: 'docs' })).toEqual({ allow: true })
    expect(await use(p, 'Bash', { command: 'git status && ls' })).toEqual({ allow: true })
    expect(await use(p, 'PowerShell', { command: 'git status; ls' })).toEqual({ allow: true })
    expect(await use(p, 'PowerShell', { command: 'npm test' })).toBeUndefined()
    expect(await use(policy({ allow: ['Bash(npm test)'] }), 'PowerShell', { command: 'npm test' })).toBeUndefined()
    expect(await use(policy({ allow: ['PowerShell(npm test)'] }), 'PowerShell', { command: 'npm test' })).toEqual({ allow: true })
  })

  it('listing_and_testing_a_path_is_free_inside_the_project_and_asked_outside_it', async () => {
    const p = policy({})
    const outside = process.platform === 'win32' ? 'E:/elsewhere' : '/elsewhere'
    for (const name of ['ReadDir', 'Exists']) {
      expect(await use(p, name, { path: '.' })).toEqual({ allow: true })
      expect(await use(p, name, { path: 'src/agent' })).toEqual({ allow: true })
      expect(await use(p, name, { path: '../sibling' })).toBeUndefined()
      expect(await use(p, name, { path: outside })).toBeUndefined()
      // A rule the user kept still covers the path it names, and a deny rule still blocks.
      expect(await use(policy({ allow: [`${name}(${outside}/**)`] }), name, { path: `${outside}/logs` })).toEqual({ allow: true })
      expect(await use(policy({ deny: [`${name}(**/.ssh)`] }), name, { path: '.ssh' })).toMatchObject({ deny: expect.stringContaining('.ssh') })
    }
  })

  it('cd_inside_the_project_is_read_only_and_cd_elsewhere_prompts', async () => {
    const p = policy({})
    expect(await use(p, 'Bash', { command: `cd "${cwd.replace(/\\/g, '/')}" && git log --oneline -15 && echo "---" && git status --short | head -30` })).toEqual({ allow: true })
    expect(await use(p, 'Bash', { command: 'cd src && ls' })).toEqual({ allow: true })
    expect(await use(p, 'Bash', { command: 'cd .. && ls' })).toBeUndefined()
    expect(await use(p, 'Bash', { command: 'cd && ls' })).toBeUndefined()
    expect(commandLines('Bash', 'cd .. && ls', [])).toEqual([{ text: 'cd ..', rule: 'Bash(cd ..)' }, { text: 'ls', passes: 'read-only' }])
  })

  it('a_cd_rule_allows_its_own_directory_and_below_it_and_no_other', async () => {
    const outside = process.platform === 'win32' ? 'E:/elsewhere' : '/elsewhere'
    const p = policy({ allow: [`Bash(cd ${outside})`] })
    expect(await use(p, 'Bash', { command: `cd ${outside} && ls` })).toEqual({ allow: true })
    expect(await use(p, 'Bash', { command: `cd ${outside}/deep/nested && ls` })).toEqual({ allow: true })
    // A directory allowed for one shell says nothing about a sibling, a parent or the other shell.
    expect(await use(p, 'Bash', { command: `cd ${outside}/../other && ls` })).toBeUndefined()
    expect(await use(p, 'Bash', { command: 'cd .. && ls' })).toBeUndefined()
    expect(await use(p, 'PowerShell', { command: `cd ${outside}; ls` })).toBeUndefined()
    // The prompt offers the directory, not `cd` as such, so allowing one place is not allowing every place.
    expect(commandLines('Bash', `cd ${outside}`, [])).toEqual([{ text: `cd ${outside}`, rule: `Bash(cd ${outside})` }])
    // A target we cannot read is no directory to name, so the blunt rule is all that is left.
    expect(commandLines('Bash', 'cd $HOME', [])).toEqual([{ text: 'cd $HOME', rule: 'Bash(cd:*)' }])
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

  it('a_substitution_holding_only_read_only_commands_needs_no_prompt', async () => {
    expect(await use(policy({}), 'Bash', { command: 'echo "count: $(ls | wc -l)"' })).toEqual({ allow: true })
  })

  it('a_rule_is_needed_for_what_a_substitution_runs_and_no_rule_covers_a_command_word_it_supplies', async () => {
    expect(await use(policy({ allow: ['Bash'] }), 'Bash', { command: 'echo $(rm x)' })).toEqual({ allow: true })
    expect(await use(policy({ allow: ['Bash(echo:*)'] }), 'Bash', { command: 'echo $(rm x)' })).toBeUndefined()
    expect(await use(policy({ allow: ['Bash'] }), 'Bash', { command: '$(which rm) -rf x' })).toBeUndefined()
    // A deny rule reaches inside a substitution too.
    expect(await use(policy({ allow: ['Bash'], deny: ['Bash(rm:*)'] }), 'Bash', { command: 'echo $(rm x)' })).toMatchObject({ deny: expect.stringContaining('Bash(rm:*)') })
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

describe('the Allow writes switch', () => {
  const use = (h: SessionHooks, toolName: string, input: unknown) => h.preToolUse!({ toolName, input, toolUseId: 't' })
  const switched = (on: () => boolean, rules: Partial<PermissionRules> = {}) =>
    new PermissionPolicy(cwd, () => ({ allow: [], deny: [], ...rules }), { readOnly, writesAllowed: on })

  it('file_writes_pass_without_a_prompt_while_the_session_switch_is_on', async () => {
    let on = false
    const p = switched(() => on)
    expect(await use(p, 'Edit', { file_path: 'src/a.ts' })).toBeUndefined()
    on = true
    for (const tool of ['Write', 'Edit', 'MultiEdit']) expect(await use(p, tool, { file_path: 'src/a.ts' }), tool).toEqual({ allow: true })
    expect(await use(p, 'NotebookEdit', { notebook_path: 'src/a.ipynb' })).toEqual({ allow: true })
    // The switch is for the project's own files: a write anywhere else is still a question.
    expect(await use(p, 'Write', { file_path: '../other/a.ts' })).toBeUndefined()
    expect(await use(p, 'Bash', { command: 'echo hi > f' })).toBeUndefined()
  })

  it('a_move_or_copy_passes_under_the_switch_only_when_both_ends_are_inside_the_project', async () => {
    let on = false
    const p = switched(() => on)
    const outside = process.platform === 'win32' ? 'E:\\elsewhere\\a.ts' : '/elsewhere/a.ts'
    expect(await use(p, 'Move', { source: 'src/a.ts', destination: 'lib/a.ts' })).toBeUndefined()
    on = true
    for (const tool of ['Move', 'Copy']) {
      expect(await use(p, tool, { source: 'src/a.ts', destination: `${cwd}/lib/a.ts` }), tool).toEqual({ allow: true })
      expect(await use(p, tool, { source: 'src/a.ts', destination: '../other/a.ts' }), tool).toBeUndefined()
      expect(await use(p, tool, { source: outside, destination: 'src/a.ts' }), tool).toBeUndefined()
      expect(await use(p, tool, { source: '.', destination: 'copy' }), tool).toBeUndefined()
    }
  })

  it('a_move_is_denied_when_a_deny_rule_names_either_end_and_allowed_only_when_a_rule_covers_both', async () => {
    const p = new PermissionPolicy(cwd, () => ({ allow: ['Move(src/**)'], deny: ['Move(**/.env)'] }), { readOnly })
    expect(await use(p, 'Move', { source: 'src/a.ts', destination: 'src/b.ts' })).toEqual({ allow: true })
    expect(await use(p, 'Move', { source: 'src/a.ts', destination: 'lib/a.ts' })).toBeUndefined()
    expect(await use(p, 'Move', { source: 'src/a.ts', destination: 'config/.env' })).toMatchObject({ deny: expect.stringContaining('Move(**/.env)') })
    expect(projectRuleFor('Move')).toBeUndefined()
  })

  it('file_changing_commands_pass_under_the_switch_when_every_path_is_inside_the_project', async () => {
    let on = false
    const p = switched(() => on)
    expect(await use(p, 'Bash', { command: 'rm -rf local-feed' })).toBeUndefined()
    on = true
    expect(await use(p, 'Bash', { command: 'rm -rf local-feed' })).toEqual({ allow: true })
    expect(await use(p, 'Bash', { command: 'mkdir -p src/SampleApi && touch src/SampleApi/a.cs' })).toEqual({ allow: true })
    expect(await use(p, 'Bash', { command: 'cp src/a.ts src/b.ts && ls' })).toEqual({ allow: true })
    expect(await use(p, 'PowerShell', { command: 'Remove-Item -Recurse -Force local-feed' })).toEqual({ allow: true })
    // The switch covers the project's own files; anything else is still a question.
    expect(await use(p, 'Bash', { command: 'rm -rf ../other' })).toBeUndefined()
    expect(await use(p, 'Bash', { command: 'mv src/a.ts /tmp/a.ts' })).toBeUndefined()
    expect(await use(p, 'Bash', { command: 'rm -rf .' })).toBeUndefined()
    expect(await use(p, 'Bash', { command: 'rm -rf $BUILD' })).toBeUndefined()
    expect(await use(p, 'Bash', { command: 'rm -rf ~/cache' })).toBeUndefined()
    // xargs adds paths the line does not name.
    expect(await use(p, 'Bash', { command: 'echo ../other | xargs rm -rf src/a' })).toBeUndefined()
    // A redirect writes a file the words do not name, and a command that is neither read-only nor a write still asks.
    expect(await use(p, 'Bash', { command: 'mkdir dist > log.txt' })).toBeUndefined()
    expect(await use(p, 'Bash', { command: 'rm -rf dist && dotnet restore' })).toBeUndefined()
  })

  it('a_cd_out_of_the_project_takes_the_switch_off_the_rest_of_the_line', async () => {
    const outside = process.platform === 'win32' ? 'E:/elsewhere' : '/elsewhere'
    const p = switched(() => true, { allow: [`Bash(cd ${outside})`] })
    // `data` would be read from the project root, but the shell removes it from wherever the `cd` left it.
    expect(await use(p, 'Bash', { command: `cd ${outside} && rm -rf data` })).toBeUndefined()
    expect(await use(p, 'Bash', { command: 'cd src && rm -rf data' })).toEqual({ allow: true })
    const request = { type: 'permission_request' as const, requestId: 'r', toolName: 'Bash', input: { command: `cd ${outside} && rm -rf data` } }
    expect(p.decorate(request)).toMatchObject({ commands: [{ text: `cd ${outside}`, passes: 'read-only' }, { text: 'rm -rf data', rule: 'Bash(rm:*)' }] })
  })

  it('a_deny_rule_still_blocks_a_command_the_switch_would_allow_and_the_prompt_names_the_switch', async () => {
    const denied = switched(() => true, { deny: ['Bash(rm:*)'] })
    expect(await use(denied, 'Bash', { command: 'rm -rf dist' })).toMatchObject({ deny: expect.stringContaining('Bash(rm:*)') })
    const p = switched(() => true)
    const request = { type: 'permission_request' as const, requestId: 'r', toolName: 'Bash', input: { command: 'rm -rf dist && dotnet restore' } }
    expect(p.decorate(request)).toMatchObject({
      commands: [{ text: 'rm -rf dist', passes: 'the Allow writes switch' }, { text: 'dotnet restore', rule: 'Bash(dotnet restore:*)' }],
    })
  })

  it('a_deny_rule_still_blocks_a_write_the_switch_would_allow', async () => {
    const p = switched(() => true, { deny: ['Write(**/.env)'] })
    expect(await use(p, 'Write', { file_path: 'config/.env' })).toMatchObject({ deny: expect.stringContaining('Write(**/.env)') })
    expect(await use(p, 'Write', { file_path: 'src/a.ts' })).toEqual({ allow: true })
  })
})
