import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { instructionPlaces } from '../src/agent/permissions/instruction-places'
import { projectMemoryDir } from '../src/agent/memory/memories'
import { commandEffect, isReadOnlyCommand } from '../src/agent/permissions/read-only-commands'
import { PermissionPolicy, type PermissionRules } from '../src/agent/permissions/permission-policy'
import { commandLines } from '../src/agent/permissions/permission-rules'
import { projectRuleFor, ruleLabel } from '../src/agent/permissions/rule-text'
import { readOnlyTools } from '../src/agent/permissions/tool-classes'
import { reviewEdits } from '../src/agent/permissions/gate'
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

  it('a_sed_script_that_runs_a_command_or_writes_a_file_asks_however_it_is_spelled', () => {
    for (const c of [
      // `e` runs a shell command, as a command of its own and as a flag on a substitution.
      "sed '1e rm -rf x' f", "sed 's/.*/rm -rf x/e' f", "sed -n 's|a|b|ge' f", "sed -e '$e rm x' f", "sed --expression='1e rm x' f",
      // `w` and `W` write any path, and `r`/`R` read one.
      "sed -n 'w /tmp/out' f", "sed 's/a/b/w /tmp/out' f", "sed -n '1W out' f", "sed '1r /etc/passwd' f",
      // Appended, inserted and changed text, and a block or a label, are shapes this does not read.
      "sed 'a\\ text' f", "sed '1{p;p}' f", "sed ':a;N;$!ba' f", "sed '1y/ab/cd/' f",
      // The script itself cannot be read: it comes from a file, or sed is told something unknown.
      'sed -f script.sed f', 'sed --file=script.sed f', 'sed --unknown-flag p f', 'sed', 'sed -n',
      // In-place editing, however it is written.
      'sed -i s/a/b/ f', 'sed -i.bak s/a/b/ f', 'sed --in-place p f', 'sed -ni p f',
      // A bracket expression holding the delimiter unescaped is a shape this does not read: escape it or pick another delimiter.
      "sed 's/[/]/-/g' f",
    ])
      expect(isReadOnlyCommand(c), c).toBe(false)
  })

  it('a_sed_script_that_only_prints_or_substitutes_runs_without_a_prompt', () => {
    for (const c of [
      'sed -n 1,10p f', "sed -n '$p' f", "sed '/foo/d' f", "sed -n '/foo/,/bar/p' f", "sed -n '2~3p' f", "sed -n '1,+4p' f",
      "sed 's/a/b/' f", "sed -E 's#(a)#\\1#g' f", "sed 's/a/b/3gp' f", "sed -n 's/a/b/Ip' f", "sed '/x/Id' f",
      // A separator or a delimiter inside a regex is text, not the end of the command.
      "sed -n '/;/p' f", "sed 's/\\//-/g' f", "sed -n '\\%a/b%p' f",
      // Several scripts, a negated address, an exit code, a comment and blank lines.
      "sed -n -e '1p' -e '$p' f", "sed -n '1!p' f", "sed '10q' f", "sed -n '1p\n\n# note\n2p' f", 'sed -n = f',
      'sed --version', 'sed --quiet 1p f', 'ls | sed -n 1p',
    ])
      expect(isReadOnlyCommand(c), c).toBe(true)
  })

  it('every_pipeline_offered_in_place_of_awk_runs_without_a_prompt_and_awk_itself_still_asks', () => {
    for (const c of [
      "ps | tr -s ' ' | cut -d' ' -f2", 'ls | sort | uniq -c', 'git log --oneline | wc -l', 'git diff --stat | tail -1',
      'cat package.json | jq -r .name', 'cat x | nl | column -t', 'comm -12 a b', 'yq .a x.yaml | head -3',
    ])
      expect(isReadOnlyCommand(c), c).toBe(true)
    for (const c of ["ps | awk '{print $2}'", "awk 'BEGIN{system(\"rm -rf x\")}'", "ps | perl -ane 'print $F[1]'"])
      expect(isReadOnlyCommand(c), c).toBe(false)
  })

  it('a_command_word_a_substitution_supplies_is_not_read_only_whatever_it_prints', () => {
    for (const c of ['$(which ls)', 'timeout 30 $(which ls)', '`which ls` -la'])
      expect(isReadOnlyCommand(c), c).toBe(false)
    // Quoted, it is text the command reads, not a command the shell runs.
    expect(isReadOnlyCommand("echo '$(rm x)'")).toBe(true)
  })
})

describe('commandEffect', () => {
  const effectOf = (command: string, ...args: string[]) => commandEffect(command, args)

  it('a_command_judged_by_its_arguments_says_what_it_would_do_not_only_that_it_asks', () => {
    expect(effectOf('sed', '-n', '1p', 'f')).toEqual({ kind: 'inspects' })
    expect(effectOf('sed', '1e rm -rf x', 'f')).toEqual({ kind: 'runs', reason: expect.stringContaining('run a command') })
    expect(effectOf('sed', '-i', 's/a/b/', 'f')).toEqual({ kind: 'mutates', reason: expect.stringContaining('edit in place') })
    expect(effectOf('sort', '-o', 'out', 'x')).toEqual({ kind: 'mutates', reason: expect.stringContaining('writes its output to a file') })
    expect(effectOf('find', '.', '-delete')).toEqual({ kind: 'mutates', reason: expect.stringContaining('deletes what it finds') })
  })

  it('a_command_handed_a_program_to_run_by_one_of_its_own_arguments_is_never_covered_by_a_rule', () => {
    expect(effectOf('find', '.', '-exec', 'rm', '{}', ';')).toEqual({ kind: 'runs', reason: expect.stringContaining('runs a program') })
    expect(effectOf('sort', '--compress-program=sh', 'x')).toEqual({ kind: 'runs', reason: expect.stringContaining('program') })
    expect(effectOf('rg', '--pre', './run.sh', 'foo')).toEqual({ kind: 'runs', reason: expect.stringContaining('program') })
    expect(effectOf('ag', '--pager=sh', 'foo')).toEqual({ kind: 'runs', reason: expect.stringContaining('program') })
    expect(effectOf('less', '+G', 'f')).toEqual({ kind: 'runs', reason: expect.stringContaining('runs a command') })
  })

  it('a_command_its_arguments_cannot_turn_into_a_write_is_not_judged_by_them_at_all', () => {
    for (const command of ['ls', 'cat', 'rm', 'npm']) expect(effectOf(command, '-la'), command).toBeUndefined()
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

  it('a_command_xargs_feeds_is_asked_about_since_neither_what_it_does_nor_what_it_reads_can_be_read_off_the_line', () => {
    // Bare xargs runs echo, which names no file and reads none.
    for (const c of ['ls | xargs', 'ls | xargs -0']) expect(isReadOnlyCommand(c), c).toBe(true)
    // `echo -delete | xargs find .` deletes, `echo -i | xargs sed s/a/b/ f` edits in place, and `echo /etc/shadow | xargs cat` reads a file the line never names.
    for (const c of [
      'ls | xargs grep -n foo', 'find . -name "*.ts" | xargs wc -l', 'ls | xargs -0 cat', 'ls | xargs -n1 -P4 head -5', 'ls | xargs -I{} cat {}',
      'ls | xargs --max-args=2 cat', 'ls | xargs timeout 5 cat', 'ls | xargs rm', 'ls | xargs sed -n 1p', 'ls | xargs find .', 'ls | xargs sort',
      'ls | xargs git log', 'ls | xargs cd', 'ls | xargs -I{} sh -c "cat {}"', 'ls | xargs --unknown cat', 'ls | xargs timeout 5 rm', 'timeout 5 xargs sort',
    ])
      expect(isReadOnlyCommand(c), c).toBe(false)
  })

  it('a_command_no_argument_could_point_at_a_file_runs_unasked_however_its_arguments_reached_it', () => {
    for (const c of ['ls | xargs echo', 'ls | xargs -I{} echo {}', 'ls | xargs printf', 'ls | xargs basename', 'ls | xargs test -f', 'ls | xargs timeout 5 echo'])
      expect(isReadOnlyCommand(c), c).toBe(true)
    // One word further and the same line reads a file it never names.
    expect(isReadOnlyCommand('ls | xargs cat')).toBe(false)
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

  it('a_tools_own_options_before_its_subcommand_stay_in_the_rule_so_the_rule_names_what_runs', () => {
    // A rule remembered for `npx` alone would cover every program npx ever fetches and runs.
    expect(commandLines('Bash', 'npx --prefix v2/web tsc --noEmit -p v2/web/tsconfig.json', [])).toEqual([
      { text: 'npx --prefix v2/web tsc --noEmit -p v2/web/tsconfig.json', rule: 'Bash(npx --prefix v2/web tsc:*)' },
    ])
    expect(commandLines('Bash', 'npm --prefix ../ts-language-mcp run build', [])).toEqual([
      { text: 'npm --prefix ../ts-language-mcp run build', rule: 'Bash(npm --prefix ../ts-language-mcp run:*)' },
    ])
    expect(commandLines('Bash', 'npm -s run build', [])).toEqual([{ text: 'npm -s run build', rule: 'Bash(npm -s run:*)' }])
    expect(commandLines('Bash', 'npx -y vsce package', [])).toEqual([{ text: 'npx -y vsce package', rule: 'Bash(npx -y vsce:*)' }])
    expect(commandLines('Bash', 'git -C ../other commit -m x', [])).toEqual([{ text: 'git -C ../other commit -m x', rule: 'Bash(git -C ../other commit:*)' }])
    expect(commandLines('Bash', 'dotnet -d test', [])).toEqual([{ text: 'dotnet -d test', rule: 'Bash(dotnet -d test:*)' }])
  })

  it('an_option_the_rule_cannot_read_leaves_it_at_the_tool_rather_than_naming_the_wrong_subcommand', () => {
    // Nobody can say whether `--loglevel` takes the next word, and `-c` hands npx a shell string of its own.
    expect(commandLines('Bash', 'npm --loglevel warn run build', [])).toEqual([{ text: 'npm --loglevel warn run build', rule: 'Bash(npm:*)' }])
    expect(commandLines('Bash', 'npx -c "rm -rf dist"', [])).toEqual([{ text: 'npx -c "rm -rf dist"', rule: 'Bash(npx:*)' }])
    // An attached value needs no such knowledge.
    expect(commandLines('Bash', 'npm --loglevel=warn run build', [])).toEqual([{ text: 'npm --loglevel=warn run build', rule: 'Bash(npm --loglevel=warn run:*)' }])
  })

  it('the_rule_offered_for_a_tool_with_leading_options_covers_that_command_next_time', () => {
    for (const command of ['npx --prefix v2/web tsc --noEmit', 'npm --prefix ../other run build', 'npm -s run build', 'git -C ../other commit -m x', 'dotnet -d test']) {
      const [line] = commandLines('Bash', command, [])
      expect(line?.rule, command).toBeDefined()
      expect(commandLines('Bash', command, [line!.rule!]), command).toEqual([{ text: command, passes: line!.rule }])
    }
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

  it('a_copy_or_move_names_what_it_reads_and_what_it_writes_and_marks_the_write_as_why_it_asks', () => {
    expect(commandLines('Bash', 'cp a.txt /tmp/b.txt', [])).toEqual([
      {
        text: 'cp a.txt /tmp/b.txt',
        rule: 'Bash(cp:*)',
        effects: [
          { kind: 'reads', path: 'a.txt', asked: false },
          { kind: 'writes', path: '/tmp/b.txt', asked: true },
        ],
      },
    ])
  })

  it('a_write_inside_the_project_is_offered_the_rule_of_its_command_whatever_lies_outside', () => {
    const context = { canRead: () => true, insideProject: (path: string) => !path.startsWith('/outside') }
    expect(commandLines('Bash', 'rm dist/old.txt', [], context)).toEqual([{ text: 'rm dist/old.txt', rule: 'Bash(rm:*)' }])
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
  const home = process.platform === 'win32' ? 'E:/home/me' : '/home/me'
  const withHome = (rules: Partial<PermissionRules>) => new PermissionPolicy(cwd, () => ({ allow: [], deny: [], ...rules }), { readOnly, home })
  /** The lines a shell prompt shows for this command. */
  const lines = (p: PermissionPolicy, command: string) => {
    const shown = p.decorate({ type: 'permission_request', requestId: 'r', toolName: 'Bash', input: { command } })
    return shown.type === 'permission_request' ? shown.commands : undefined
  }
  /** What a change of directory offers to keep: these directories, the first pre-selected, for the person. */
  const offer = (...directories: string[]) => ({
    rule: `Bash(cd ${directories[0]})`,
    places: directories.map((directory) => ({ directory, rule: `Bash(cd ${directory})` })),
    scope: 'person',
  })

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

  it('a_tool_that_only_reads_is_free_inside_the_project_and_asked_for_a_path_outside_it', async () => {
    const p = policy({})
    const outside = process.platform === 'win32' ? 'E:/elsewhere' : '/elsewhere'
    expect(await use(p, 'Read', { file_path: 'src/a.ts' })).toEqual({ allow: true })
    expect(await use(p, 'Read', { file_path: `${outside}/.ssh/id_rsa` })).toBeUndefined()
    expect(await use(p, 'Read', { file_path: '../sibling/src/a.ts' })).toBeUndefined()
    expect(await use(p, 'CodeSearch', { query: 'x', path: '../sibling' })).toBeUndefined()
    expect(await use(p, 'MarkdownSearch', { query: 'x', path: outside })).toBeUndefined()
    // A search names its ground by pattern as much as by path, so the pattern is judged too.
    expect(await use(p, 'Glob', { pattern: 'src/**/*.ts' })).toEqual({ allow: true })
    expect(await use(p, 'Glob', { pattern: '../sibling/**/*.ts' })).toBeUndefined()
    // Naming no path at all is working in the project.
    expect(await use(p, 'Grep', { pattern: 'x' })).toEqual({ allow: true })
    // The rules are how reading outside is granted, once.
    expect(await use(policy({ allow: [`Read(${outside}/**)`] }), 'Read', { file_path: `${outside}/notes.md` })).toEqual({ allow: true })
  })

  it('a_sessions_own_instructions_are_read_without_a_prompt_wherever_they_are_kept_and_written_with_one', async () => {
    const home = process.platform === 'win32' ? 'D:\\home\\jonas' : '/home/jonas'
    const p = new PermissionPolicy(cwd, () => ({ allow: [], deny: [] }), { readOnly, readable: instructionPlaces(cwd, [], home) })
    const call = (toolName: string, input: unknown) => p.preToolUse({ toolName, input, toolUseId: 't' })
    const skill = join(home, '.claude', 'skills', 'spec-writing')
    // Loading a skill names no path at all; the files it refers to are read where it lies.
    expect(await call('Skill', { skill: 'spec-writing' })).toEqual({ allow: true })
    expect(await call('Read', { file_path: join(skill, 'SKILL.md') })).toEqual({ allow: true })
    expect(await call('Glob', { pattern: join(skill, 'templates', '*.md') })).toEqual({ allow: true })
    expect(await call('Bash', { command: `cat ${skill.split('\\').join('/')}/SKILL.md` })).toEqual({ allow: true })
    // A sub agent's definition, the memory notes and the person's own instructions, the same way.
    expect(await call('Read', { file_path: join(home, '.kiwi', 'agents', 'reviewer.md') })).toEqual({ allow: true })
    expect(await call('Read', { file_path: join(projectMemoryDir(cwd, home), 'no-git-commands.md') })).toEqual({ allow: true })
    expect(await call('Read', { file_path: join(home, 'AGENTS.md') })).toEqual({ allow: true })
    // Nothing else of the person's opens up alongside them.
    expect(await call('Read', { file_path: join(home, '.claude', '.credentials.json') })).toBeUndefined()
    expect(await call('Read', { file_path: join(home, 'notes.md') })).toBeUndefined()
    // Writing there is a write like any other.
    expect(await call('Write', { file_path: join(skill, 'SKILL.md'), content: 'x' })).toBeUndefined()
  })

  it('a_command_that_only_inspects_is_asked_about_when_it_reads_outside_the_project', async () => {
    const p = policy({})
    const outside = process.platform === 'win32' ? 'E:/elsewhere' : '/elsewhere'
    for (const c of ['cat src/a.ts', 'grep -rn foo src', 'wc -l src/a.ts src/b.ts', 'head -5 package.json', 'ls src', 'diff src/a.ts src/b.ts', 'git log --oneline'])
      expect(await use(p, 'Bash', { command: c }), c).toEqual({ allow: true })
    for (const c of [
      `cat ${outside}/.env`, 'cat ../sibling/.env', `grep -rn secret ${outside}`, `wc -l src/a.ts ${outside}/b.ts`, `head -5 ${outside}/x`,
      `ls ${outside}`, `diff src/a.ts ${outside}/b.ts`, `sed -n 1p ${outside}/x`, `find ${outside} -name "*.env"`, `git -C ${outside} log`,
      // A file fed in by a redirect is read as surely as one named as an argument.
      `cat < ${outside}/.env`, 'grep foo < ../sibling/.env',
    ])
      expect(await use(p, 'Bash', { command: c }), c).toBeUndefined()
    // A word that is no path stays a word: a pattern is not judged as the file it would name.
    expect(await use(p, 'Bash', { command: 'grep /etc/passwd src/a.ts' })).toEqual({ allow: true })
    for (const c of ['echo /etc/passwd', `basename ${outside}/x`, 'pwd', 'whoami'])
      expect(await use(p, 'Bash', { command: c }), c).toEqual({ allow: true })
    // Granted once, by a rule for the command or by the directory being one the session may work in.
    expect(await use(policy({ allow: [`Bash(cat ${outside}/.env)`] }), 'Bash', { command: `cat ${outside}/.env` })).toEqual({ allow: true })
    expect(await use(policy({ allow: [`Bash(cd ${outside})`] }), 'Bash', { command: `cat ${outside}/.env` })).toEqual({ allow: true })
  })

  it('cd_inside_the_project_is_read_only_and_cd_elsewhere_prompts', async () => {
    const p = policy({})
    expect(await use(p, 'Bash', { command: `cd "${cwd.replace(/\\/g, '/')}" && git log --oneline -15 && echo "---" && git status --short | head -30` })).toEqual({ allow: true })
    expect(await use(p, 'Bash', { command: 'cd src && ls' })).toEqual({ allow: true })
    expect(await use(p, 'Bash', { command: 'cd .. && ls' })).toBeUndefined()
    expect(await use(p, 'Bash', { command: 'cd && ls' })).toBeUndefined()
    // Reaching here means the directory is not ground the project already stands on, so it is kept for the person rather than the workspace.
    const parent = process.platform === 'win32' ? 'D:/work' : '/work'
    expect(lines(p, 'cd .. && ls')).toEqual([{ text: 'cd ..', ...offer(parent) }, { text: 'ls', passes: 'read-only' }])
  })

  it('paths_after_a_cd_inside_the_project_are_read_from_where_the_shell_stands', async () => {
    const p = policy({})
    const command =
      'cd v2/backend/BankBook.Api/Features/Bankkoppling && wc -l * && cat BankkopplingController.cs Bankkoppling.cs && ls ../../../BankBook.Api.Tests/Features ../../../BankBook.Core.Tests'
    expect(await use(p, 'Bash', { command })).toEqual({ allow: true })
    expect(await use(p, 'Bash', { command: 'cd src && cd .. && ls src' })).toEqual({ allow: true })
    expect(await use(p, 'Bash', { command: 'cd src && cat ../../sibling/.env' })).toBeUndefined()
    // The prompt lists the same lines as read-only, the `cd` among them.
    const shown = p.decorate({ type: 'permission_request', requestId: 'r', toolName: 'Bash', input: { command } })
    expect(shown.type === 'permission_request' && shown.commands?.every((line) => line.passes === 'read-only')).toBe(true)
  })

  it('a_cd_the_next_command_may_run_without_leaves_its_paths_read_from_every_place_it_could_stand', async () => {
    const p = policy({})
    // `../x` lies outside the project from the root, where each of these may still stand when `cat` runs.
    for (const c of ['cd src; cat ../x', 'cd src || cat ../x', 'cd src | cat ../x', '(cd src) && cat ../x', 'false || cd src && cat ../x', 'for d in a; do cd src && cat ../x; done'])
      expect(await use(p, 'Bash', { command: c }), c).toBeUndefined()
  })

  it.runIf(process.platform === 'win32')('git_bash_drive_paths_stand_for_the_windows_drive_they_name', async () => {
    const p = policy({})
    expect(await use(p, 'Bash', { command: 'cd /d/work/repo && ls' })).toEqual({ allow: true })
    expect(await use(p, 'Bash', { command: 'cd /d/work/repo/src && ls' })).toEqual({ allow: true })
    expect(await use(p, 'Bash', { command: 'cd /d/work && ls' })).toBeUndefined()
    expect(await use(policy({ allow: ['Bash(cd /e/elsewhere)'] }), 'Bash', { command: 'cd E:/elsewhere/deep && ls' })).toEqual({ allow: true })
    // PowerShell reads the same path as a folder on the current drive.
    expect(await use(p, 'PowerShell', { command: 'cd /d/work/repo; ls' })).toBeUndefined()
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
  })

  it('a_cd_offers_its_directory_and_each_one_above_it_up_to_below_the_drive_root', () => {
    const outside = process.platform === 'win32' ? 'E:/elsewhere' : '/elsewhere'
    // The prompt offers the directory, not `cd` as such, so allowing one place is not allowing every place.
    // Ground outside the project is kept for the person: a rule about it says nothing in any other workspace.
    expect(lines(policy({}), `cd ${outside}/a/b`)).toEqual([{ text: `cd ${outside}/a/b`, ...offer(`${outside}/a/b`, `${outside}/a`, outside) }])
  })

  it('a_relative_cd_offers_the_absolute_place_it_reaches_from_where_the_shell_stands', () => {
    const outside = process.platform === 'win32' ? 'E:/elsewhere' : '/elsewhere'
    expect(lines(policy({}), `cd ${outside} && cd deep`)?.[1]).toEqual({ text: 'cd deep', ...offer(`${outside}/deep`, outside) })
  })

  it('a_cd_whose_target_cannot_be_named_offers_no_rule_rather_than_every_directory', () => {
    for (const c of ['cd $HOME', 'cd -', 'cd ~other/x'])
      expect(lines(withHome({}), c), c).toEqual([{ text: c }])
  })

  it('cd_to_the_previous_directory_is_asked_every_time', async () => {
    expect(await use(policy({}), 'Bash', { command: 'cd - && ls' })).toBeUndefined()
  })

  it('a_wildcard_in_a_cd_offers_only_the_directories_above_it_and_a_grant_there_covers_it', async () => {
    const command = 'cd ~/.cargo/registry/src/*/v8/src'
    expect(lines(withHome({}), command)).toEqual([{ text: command, ...offer(`${home}/.cargo/registry/src`, `${home}/.cargo/registry`, `${home}/.cargo`) }])
    expect(await use(withHome({ allow: [`Bash(cd ${home}/.cargo/registry)`] }), 'Bash', { command: `${command} && ls` })).toEqual({ allow: true })
    expect(await use(withHome({ allow: [`Bash(cd ${home}/.cargo/registry)`] }), 'Bash', { command: 'cd ~/.cargo && ls' })).toBeUndefined()
  })

  it('the_home_folder_and_every_directory_holding_it_are_never_offered', () => {
    const above = home.slice(0, home.lastIndexOf('/'))
    for (const c of ['cd ~', `cd ${home}`, `cd ${above}`]) expect(lines(withHome({}), c), c).toEqual([{ text: c }])
    expect(lines(withHome({}), 'cd ~/projects/x')).toEqual([{ text: 'cd ~/projects/x', ...offer(`${home}/projects/x`, `${home}/projects`) }])
  })

  it('a_denied_directory_refuses_every_cd_into_its_tree_whatever_a_narrower_allow_says', async () => {
    const outside = process.platform === 'win32' ? 'E:/elsewhere' : '/elsewhere'
    const p = policy({ deny: [`Bash(cd ${outside})`], allow: [`Bash(cd ${outside}/deep)`] })
    expect(await use(p, 'Bash', { command: `cd ${outside}/deep/x && ls` })).toMatchObject({ deny: expect.stringContaining(`cd ${outside}`) })
    expect(await use(p, 'Bash', { command: `cd ${outside}/../other && ls` })).toBeUndefined()
  })

  it('a_command_naming_no_path_is_judged_by_where_the_shell_stands', async () => {
    const outside = process.platform === 'win32' ? 'E:/elsewhere' : '/elsewhere'
    const sibling = process.platform === 'win32' ? 'E:/other' : '/other'
    const p = policy({ allow: [`Bash(cd ${outside})`] })
    // `pwd` and `ls` name no path at all, so their place is wherever the line already stands: the project by default, and the directory a `cd` carried it to.
    expect(await use(p, 'Bash', { command: 'pwd' })).toEqual({ allow: true })
    expect(await use(p, 'Bash', { command: `cd ${outside} && pwd` })).toEqual({ allow: true })
    // Standing there is still carried to a further move beneath it.
    expect(await use(p, 'Bash', { command: `cd ${outside} && cd deep/nested && pwd` })).toEqual({ allow: true })
    // A sibling is not granted by the first `cd`, so moving there still asks before any of the line runs.
    expect(await use(p, 'Bash', { command: `cd ${outside} && cd ${sibling} && pwd` })).toBeUndefined()
  })

  it('a_command_not_known_to_inspect_still_asks_wherever_the_shell_stands', async () => {
    const outside = process.platform === 'win32' ? 'E:/elsewhere' : '/elsewhere'
    const p = policy({ allow: [`Bash(cd ${outside})`] })
    // Standing in ground the person has granted says nothing about the network or the person's own configuration.
    expect(await use(p, 'Bash', { command: `cd ${outside} && dotnet build` })).toBeUndefined()
  })

  it('a_cd_whose_target_cannot_be_read_is_asked_about_before_any_of_the_line_runs', async () => {
    const p = policy({})
    for (const c of ['cd $HOME && ls', 'cd ~ && ls'])
      expect(await use(p, 'Bash', { command: c }), c).toBeUndefined()
  })

  it('a_writes_rule_covers_every_write_tool_on_the_paths_its_glob_names_and_nothing_else', async () => {
    const p = policy({ allow: ['Writes(docs/product.md)', 'Writes(specs/**)'] })
    for (const tool of ['Write', 'Edit', 'MultiEdit']) expect(await use(p, tool, { file_path: 'docs/product.md' }), tool).toEqual({ allow: true })
    expect(await use(p, 'RunScript', { files: ['specs/a.spec.md', 'specs/deep/b.md'] })).toEqual({ allow: true })
    expect(await use(p, 'Edit', { file_path: 'docs/glossary.md' })).toBeUndefined()
    expect(await use(p, 'RunScript', { files: ['specs/a.spec.md', 'docs/glossary.md'] })).toBeUndefined()
    // A rule for writes says nothing about reading, and nothing about what a shell command writes.
    expect(await use(p, 'Bash', { command: 'echo x > docs/product.md' })).toBeUndefined()
    expect(await use(policy({ deny: ['Writes(docs/**)'] }), 'Write', { file_path: 'docs/a.md' })).toMatchObject({ deny: expect.stringContaining('Writes(docs/**)') })
  })

  it('a_write_rule_names_one_folder_outside_the_project_and_covers_what_lies_beneath_it', async () => {
    const outside = process.platform === 'win32' ? 'E:/elsewhere' : '/elsewhere'
    const p = policy({ allow: [`Bash(write ${outside}/data)`] })
    expect(await use(p, 'Bash', { command: `cp a.txt ${outside}/data/out.txt` })).toEqual({ allow: true })
    expect(await use(p, 'Bash', { command: `cp a.txt ${outside}/data/deep/out.txt` })).toEqual({ allow: true })
    // A sibling folder is not granted by naming this one.
    expect(await use(p, 'Bash', { command: `cp a.txt ${outside}/other/out.txt` })).toBeUndefined()
    // Naming where a write may land says nothing about where it may read from.
    expect(await use(p, 'Bash', { command: `cp ${outside}/src.txt ${outside}/data/out.txt` })).toBeUndefined()
    // The rule names a shell's write; a file tool's own write is judged by the rules for that kind instead.
    expect(await use(p, 'Write', { file_path: `${outside}/data/out.txt` })).toBeUndefined()
    const denied = await use(policy({ deny: [`Bash(write ${outside}/data)`] }), 'Bash', { command: `cp a.txt ${outside}/data/out.txt` })
    expect(denied).toMatchObject({ deny: expect.stringContaining(`write ${outside}/data`) })
  })

  describe('what a kept directory covers', () => {
    const outside = process.platform === 'win32' ? 'E:/elsewhere' : '/elsewhere'
    const other = process.platform === 'win32' ? 'E:/other' : '/other'

    it('a_kept_read_directory_covers_shell_and_file_tools_in_it_and_below_it_but_not_a_sibling_or_the_parent', async () => {
      const p = policy({ allow: [`Bash(read ${outside}/a)`, `Read(read ${outside}/a)`] })
      expect(await use(p, 'Bash', { command: `cat ${outside}/a/x.txt` })).toEqual({ allow: true })
      expect(await use(p, 'Bash', { command: `ls ${outside}/a/deep/er` })).toEqual({ allow: true })
      expect(await use(p, 'Read', { file_path: `${outside}/a/deep/x.txt` })).toEqual({ allow: true })
      expect(await use(p, 'Bash', { command: `cat ${outside}/b/x.txt` })).toBeUndefined()
      expect(await use(p, 'Bash', { command: `cat ${outside}/x.txt` })).toBeUndefined()
      expect(await use(p, 'Read', { file_path: `${outside}/b/x.txt` })).toBeUndefined()
    })

    it('a_kept_write_directory_covers_writes_beneath_it_and_a_sibling_is_still_asked', async () => {
      const p = policy({ allow: [`Bash(write ${outside}/a)`] })
      expect(await use(p, 'Bash', { command: `touch ${outside}/a/deep/x` })).toEqual({ allow: true })
      expect(await use(p, 'Bash', { command: `touch ${outside}/b/x` })).toBeUndefined()
    })

    it('a_directory_the_session_may_change_into_is_one_it_may_read_through_shell_and_file_tools', async () => {
      const p = policy({ allow: [`Bash(cd ${outside}/a)`, `Read(cd ${outside}/a)`] })
      expect(await use(p, 'Bash', { command: `cat ${outside}/a/x.txt` })).toEqual({ allow: true })
      expect(await use(p, 'Read', { file_path: `${outside}/a/x.txt` })).toEqual({ allow: true })
    })

    it('a_write_grant_allows_reading_in_the_same_place', async () => {
      const p = policy({ allow: [`Bash(write ${outside}/a)`, `Edit(write ${outside}/a)`] })
      expect(await use(p, 'Bash', { command: `cat ${outside}/a/x.txt` })).toEqual({ allow: true })
      expect(await use(p, 'Read', { file_path: `${outside}/a/x.txt` })).toEqual({ allow: true })
      expect(await use(p, 'Bash', { command: `cat ${outside}/b/x.txt` })).toBeUndefined()
    })

    it('a_kept_read_denial_refuses_reads_and_writes_in_its_tree_whatever_a_narrower_allow_says', async () => {
      const p = policy({ deny: [`Bash(read ${outside})`, `Read(read ${outside})`], allow: [`Bash(read ${outside}/a)`] })
      expect(await use(p, 'Bash', { command: `cat ${outside}/a/x.txt` })).toMatchObject({ deny: expect.any(String) })
      expect(await use(p, 'Bash', { command: `touch ${outside}/a/x.txt` })).toMatchObject({ deny: expect.any(String) })
      expect(await use(p, 'Bash', { command: `cd ${outside}/a && ls` })).toMatchObject({ deny: expect.any(String) })
      expect(await use(p, 'Read', { file_path: `${outside}/a/x.txt` })).toMatchObject({ deny: expect.any(String) })
      expect(await use(p, 'Bash', { command: `cat ${other}/x.txt` })).toBeUndefined()
    })

    it('a_write_denial_refuses_writes_only_and_the_directory_may_still_be_read', async () => {
      const p = policy({ deny: [`Bash(write ${outside})`, `Write(write ${outside})`], allow: [`Bash(read ${outside})`] })
      expect(await use(p, 'Bash', { command: `touch ${outside}/a/x` })).toMatchObject({ deny: expect.any(String) })
      expect(await use(p, 'Write', { file_path: `${outside}/a/x` })).toMatchObject({ deny: expect.any(String) })
      expect(await use(p, 'Bash', { command: `cat ${outside}/a/x` })).toEqual({ allow: true })
    })

    it('a_kept_cd_denial_refuses_reading_in_the_same_tree', async () => {
      const p = policy({ deny: [`Bash(cd ${outside})`] })
      expect(await use(p, 'Bash', { command: `cat ${outside}/a/x.txt` })).toMatchObject({ deny: expect.any(String) })
    })
  })

  it('a_write_prompt_is_left_as_it_came_since_its_answer_reaches_no_further_than_the_call', () => {
    const p = policy({})
    const request = (toolName: string, input: unknown) => ({ type: 'permission_request' as const, requestId: 'r', toolName, input })
    for (const asked of [request('Edit', { file_path: 'docs/product.md' }), request('Move', { source: 'a.md', destination: 'b.md' })])
      expect(p.decorate(asked)).toBe(asked)
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

  it('a_delegation_naming_the_research_sub_agent_is_asked_about_unless_a_rule_allows_it_once_for_the_project', async () => {
    expect(await use(policy({}), 'Delegate', { agent: 'research', task: 'look it up' })).toBeUndefined()
    expect(await use(policy({ allow: ['Delegate'] }), 'Delegate', { agent: 'research', task: 'look it up' })).toEqual({ allow: true })
  })

  it('a_delegation_naming_any_other_sub_agent_is_never_asked_about_however_the_rules_stand', async () => {
    const p = policy({})
    expect(await use(p, 'Delegate', { agent: 'retrieve', task: 'look it up' })).toEqual({ allow: true })
    expect(await use(p, 'Delegate', { define: { name: 'x', description: 'd', instructions: 'i' }, task: 'look it up' })).toEqual({ allow: true })
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

  it('a_command_handed_a_program_to_run_by_its_own_arguments_is_asked_about_even_when_a_rule_would_otherwise_cover_it', async () => {
    expect(await use(policy({ allow: ['Bash(find:*)'] }), 'Bash', { command: 'find . -exec rm {} \\;' })).toBeUndefined()
    expect(await use(policy({ allow: ['Bash(sed:*)'] }), 'Bash', { command: "sed '1e rm -rf x' f" })).toBeUndefined()
    // The same command without that argument is an ordinary mutation, which the rule still covers.
    expect(await use(policy({ allow: ['Bash(find:*)'] }), 'Bash', { command: 'find . -delete' })).toEqual({ allow: true })
    expect(commandLines('Bash', 'find . -exec rm {} \\;', ['Bash(find:*)'])).toEqual([{ text: 'find . -exec rm {} \\;' }])
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

describe('denying git writes', () => {
  const run = (command: string, rules: Partial<PermissionRules> = {}, toolName = 'Bash') =>
    new PermissionPolicy(cwd, () => ({ allow: [], deny: [], denyGitWrites: true, ...rules })).preToolUse({ toolName, input: { command }, toolUseId: 't' })

  it('every_git_command_that_changes_the_repository_is_blocked_however_it_is_run', async () => {
    for (const c of ['git commit -m x', 'git push', 'git stash', 'ls && git checkout main', 'timeout 30 git reset --hard', 'ls | xargs git branch -D', 'git config user.name x', 'git -c core.pager=sh log'])
      expect(await run(c), c).toMatchObject({ deny: expect.stringContaining('denyGitWrites') })
    expect(await run('git commit -m x', {}, 'PowerShell')).toMatchObject({ deny: expect.stringContaining('denyGitWrites') })
  })

  it('an_allow_rule_does_not_let_a_git_write_through', async () => {
    expect(await run('git push', { allow: ['Bash'] })).toMatchObject({ deny: expect.stringContaining('denyGitWrites') })
  })

  it('git_that_only_reads_is_not_blocked_even_with_global_options_or_its_output_redirected', async () => {
    for (const c of ['git status', 'git --no-pager diff', 'git -P log', 'git -C sub log --oneline', 'git config --get user.name'])
      expect(await run(c), c).toEqual({ allow: true })
    // Writing the log to a file is a file write, asked about like any other, not a git write.
    expect(await run('git log > log.txt')).toBeUndefined()
  })

  it('git_writes_are_only_asked_about_while_the_setting_is_off', async () => {
    expect(await run('git commit -m x', { denyGitWrites: false })).toBeUndefined()
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
    // A redirect is a write to the file it names, in the project like any other.
    expect(await use(p, 'Bash', { command: 'echo hi > f' })).toEqual({ allow: true })
    expect(await use(p, 'Bash', { command: 'echo hi > ../other/f' })).toBeUndefined()
  })

  it('a_write_to_a_file_that_decides_what_runs_unasked_is_always_asked', async () => {
    const p = switched(() => true, { allow: ['Edit', 'Write', 'Bash(cp:*)'] })
    for (const file of ['package.json', '.vscode/settings.json', '.mcp.json', 'repo.code-workspace']) {
      expect(await use(p, 'Edit', { file_path: file }), file).toBeUndefined()
    }
    expect(await use(p, 'RunScript', { files: ['src/a.ts', 'package.json'] })).toBeUndefined()
    expect(await use(p, 'Move', { source: 'package.json', destination: 'old.json' })).toBeUndefined()
    expect(await use(p, 'Bash', { command: 'cp template.json package.json' })).toBeUndefined()
    // Only the root package.json's scripts run unasked, so a nested one is an ordinary file.
    expect(await use(p, 'Edit', { file_path: 'frontend/package.json' })).toEqual({ allow: true })
    expect(await use(p, 'Edit', { file_path: 'src/a.ts' })).toEqual({ allow: true })
  })

  it('a_write_to_where_the_persons_own_rules_are_kept_is_always_asked_like_the_workspaces_settings', async () => {
    const home = process.platform === 'win32' ? 'D:\\home\\jonas' : '/home/jonas'
    const kiwiDir = join(home, '.kiwi')
    const rulesFile = join(kiwiDir, 'permissions.json')
    const p = new PermissionPolicy(cwd, () => ({ allow: [`Bash(write ${kiwiDir})`], deny: [] }), { readOnly, personRulesFile: rulesFile })
    // A folder grant covering that same folder still does not reach the one file that decides what runs unasked.
    expect(await use(p, 'Bash', { command: `echo x > ${join(kiwiDir, 'notes.md').split('\\').join('/')}` })).toEqual({ allow: true })
    expect(await use(p, 'Bash', { command: `echo x > ${rulesFile.split('\\').join('/')}` })).toBeUndefined()
    expect(await use(p, 'Edit', { file_path: rulesFile })).toBeUndefined()
  })

  it('a_deny_rule_still_blocks_a_write_to_a_trust_file', async () => {
    const p = switched(() => true, { deny: ['Edit(package.json)'] })
    expect(await use(p, 'Edit', { file_path: 'package.json' })).toMatchObject({ deny: expect.stringContaining('Edit(package.json)') })
  })

  it('the_changes_a_script_staged_pass_under_the_switch_like_any_other_write', async () => {
    let on = false
    const p = switched(() => on)
    const staged = { files: ['src/a.ts', 'src/b.ts'] }
    expect(await use(p, 'RunScript', staged)).toBeUndefined()
    on = true
    expect(await use(p, 'RunScript', staged)).toEqual({ allow: true })
    // The switch is for the project's own files: one staged anywhere else is still a question for all of them.
    expect(await use(p, 'RunScript', { files: ['src/a.ts', '../other/a.ts'] })).toBeUndefined()
    expect(await use(p, 'RunScript', { files: [] })).toBeUndefined()
  })

  it('a_deny_rule_blocks_a_staged_change_and_an_allow_rule_covering_every_file_applies_them_unasked', async () => {
    const p = new PermissionPolicy(cwd, () => ({ allow: ['RunScript(src/**)'], deny: ['RunScript(**/.env)'] }), { readOnly })
    expect(await use(p, 'RunScript', { files: ['src/a.ts', 'src/b.ts'] })).toEqual({ allow: true })
    expect(await use(p, 'RunScript', { files: ['src/a.ts', 'lib/a.ts'] })).toBeUndefined()
    expect(await use(p, 'RunScript', { files: ['src/a.ts', 'config/.env'] })).toMatchObject({ deny: expect.stringContaining('RunScript(**/.env)') })
  })

  it('the_script_review_asks_only_for_what_the_rules_leave_open', async () => {
    let on = false
    let asked = 0
    const ask = async () => (asked++, { kind: 'allow' } as const)
    const review = (files: string[]) => reviewEdits(switched(() => on, { deny: ['RunScript(**/.env)'] }), ask, { toolName: 'RunScript', input: { files }, toolUseId: 't' }, {})

    expect(await review(['src/a.ts'])).toEqual({ kind: 'allow' })
    expect(asked).toBe(1)
    on = true
    expect(await review(['src/a.ts'])).toEqual({ kind: 'allow' })
    expect(asked, 'the switch covers it, so the user is not asked again').toBe(1)
    expect(await review(['config/.env'])).toMatchObject({ kind: 'deny' })
    expect(asked, 'a deny rule answers without asking').toBe(1)
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

  it('a_shell_copy_or_move_is_judged_as_a_read_at_its_source_and_a_write_at_its_destination', async () => {
    const p = switched(() => true)
    expect(await use(p, 'Bash', { command: 'cp src/a.ts src/b.ts' })).toEqual({ allow: true })
    // The destination is in the project, but the source is not something the session may read.
    expect(await use(p, 'Bash', { command: 'cp ../other/a.ts src/b.ts' })).toBeUndefined()
    // The source is readable, but the destination is not something the switch may write.
    expect(await use(p, 'Bash', { command: 'cp src/a.ts ../other/b.ts' })).toBeUndefined()
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
    // A redirect is a write to the file it names, so one inside the project passes with the rest of the line.
    expect(await use(p, 'Bash', { command: 'mkdir dist > log.txt' })).toEqual({ allow: true })
    expect(await use(p, 'Bash', { command: 'mkdir dist > ../other/log.txt' })).toBeUndefined()
    // A command that is neither read-only nor a write still asks.
    expect(await use(p, 'Bash', { command: 'rm -rf dist && dotnet restore' })).toBeUndefined()
  })

  it('a_cd_out_of_the_project_takes_the_switch_off_the_rest_of_the_line', async () => {
    const outside = process.platform === 'win32' ? 'E:/elsewhere' : '/elsewhere'
    const p = switched(() => true, { allow: [`Bash(cd ${outside})`] })
    // `data` would be read from the project root, but the shell removes it from wherever the `cd` left it.
    expect(await use(p, 'Bash', { command: `cd ${outside} && rm -rf data` })).toBeUndefined()
    expect(await use(p, 'Bash', { command: 'cd src && rm -rf data' })).toEqual({ allow: true })
    const request = { type: 'permission_request' as const, requestId: 'r', toolName: 'Bash', input: { command: `cd ${outside} && rm -rf data` } }
    expect(p.decorate(request)).toMatchObject({ commands: [{ text: `cd ${outside}`, passes: 'read-only' }, { text: 'rm -rf data', rule: `Bash(write ${outside}/data)` }] })
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

describe('the scratch folder', () => {
  const scratch = '.kiwi/scratch/s1'
  const use = (h: SessionHooks, toolName: string, input: unknown) => h.preToolUse!({ toolName, input, toolUseId: 't' })
  const policy = (rules: Partial<PermissionRules> = {}) => new PermissionPolicy(cwd, () => ({ allow: [], deny: [], ...rules }), { readOnly, scratch })

  it('writes_in_the_scratch_folder_pass_with_the_switch_off_and_writes_elsewhere_still_ask', async () => {
    const p = policy()
    for (const tool of ['Write', 'Edit', 'MultiEdit']) expect(await use(p, tool, { file_path: `${scratch}/probe.mjs` }), tool).toEqual({ allow: true })
    expect(await use(p, 'Write', { file_path: `${cwd}/${scratch}/deep/probe.mjs` })).toEqual({ allow: true })
    expect(await use(p, 'RunScript', { files: [`${scratch}/a.mjs`, `${scratch}/b.mjs`] })).toEqual({ allow: true })
    expect(await use(p, 'Move', { source: `${scratch}/a.mjs`, destination: `${scratch}/b.mjs` })).toEqual({ allow: true })
    expect(await use(p, 'Write', { file_path: 'src/a.ts' })).toBeUndefined()
    expect(await use(p, 'RunScript', { files: [`${scratch}/a.mjs`, 'src/a.ts'] })).toBeUndefined()
    expect(await use(p, 'Move', { source: `${scratch}/a.mjs`, destination: 'src/a.mjs' })).toBeUndefined()
    // Another session's folder is not this one's.
    expect(await use(p, 'Write', { file_path: '.kiwi/scratch/s2/a.mjs' })).toBeUndefined()
    expect(await use(p, 'Write', { file_path: `${scratch}/../../runs/s1/events.jsonl` })).toBeUndefined()
  })

  it('a_deny_rule_still_blocks_a_write_in_the_scratch_folder', async () => {
    const p = policy({ deny: ['Write(.kiwi/**)'] })
    expect(await use(p, 'Write', { file_path: `${scratch}/probe.mjs` })).toMatchObject({ deny: expect.stringContaining('Write(.kiwi/**)') })
  })

  it('file_changing_commands_in_the_scratch_folder_pass_and_a_cd_out_of_it_makes_them_ask', async () => {
    const p = policy()
    expect(await use(p, 'Bash', { command: `mkdir -p ${scratch}/probe && touch ${scratch}/probe/a.ts` })).toEqual({ allow: true })
    expect(await use(p, 'Bash', { command: `rm -rf ${scratch}/probe` })).toEqual({ allow: true })
    expect(await use(p, 'Bash', { command: `cd ${scratch} && rm -rf ${scratch}/probe` })).toEqual({ allow: true })
    expect(await use(p, 'Bash', { command: 'rm -rf src/a.ts' })).toBeUndefined()
    // From `src` the path lands in `src/.kiwi/...`, which is not the scratch folder.
    expect(await use(p, 'Bash', { command: `cd src && rm -rf ${scratch}/probe` })).toBeUndefined()
  })

  it('running_a_script_from_the_scratch_folder_is_still_asked', async () => {
    expect(await use(policy(), 'Bash', { command: `node ${scratch}/probe.mjs` })).toBeUndefined()
  })

  it('a_prompt_line_the_scratch_folder_covers_says_so', () => {
    const request = { type: 'permission_request' as const, requestId: 'r', toolName: 'Bash', input: { command: `rm -rf ${scratch}/probe && dotnet restore` } }
    expect(policy().decorate(request)).toMatchObject({
      commands: [{ text: `rm -rf ${scratch}/probe`, passes: 'the scratch folder' }, { text: 'dotnet restore', rule: 'Bash(dotnet restore:*)' }],
    })
  })

  it('with_the_switch_on_the_whole_project_is_writable_as_before', async () => {
    const p = new PermissionPolicy(cwd, () => ({ allow: [], deny: [] }), { readOnly, scratch, writesAllowed: () => true })
    expect(await use(p, 'Write', { file_path: 'src/a.ts' })).toEqual({ allow: true })
    expect(await use(p, 'Write', { file_path: `${scratch}/a.mjs` })).toEqual({ allow: true })
  })
})

describe('a read or a write outside the project', () => {
  const outside = process.platform === 'win32' ? 'E:/elsewhere' : '/elsewhere'
  const parent = process.platform === 'win32' ? 'D:/work' : '/work'
  const home = process.platform === 'win32' ? 'E:/home/me' : '/home/me'
  const policy = (allow: string[] = []) => new PermissionPolicy(cwd, () => ({ allow, deny: [] }), { readOnly, home })
  const lines = (command: string, allow: string[] = []) => {
    const shown = policy(allow).decorate({ type: 'permission_request', requestId: 'r', toolName: 'Bash', input: { command } })
    return shown.type === 'permission_request' ? shown.commands : undefined
  }
  /** What a place offers to keep: this directory and each above it, for the person. */
  const keep = (verb: string, ...directories: string[]) => ({
    rule: `Bash(${verb} ${directories[0]})`,
    places: directories.map((directory) => ({ directory, rule: `Bash(${verb} ${directory})` })),
    scope: 'person',
  })

  it('is_asked_about_as_the_directory_it_reaches_and_never_as_the_command', () => {
    expect(lines(`cat ${outside}/a/b.txt`)).toEqual([
      { text: `cat ${outside}/a/b.txt`, access: { kind: 'reads', directory: `${outside}/a` }, ...keep('read', `${outside}/a`, outside) },
    ])
    expect(lines(`ls ${outside}/a`)?.[0]).toMatchObject({ access: { kind: 'reads', directory: `${outside}/a` } })
    expect(lines(`rm ${outside}/a/old.txt`)).toEqual([
      { text: `rm ${outside}/a/old.txt`, access: { kind: 'writes', directory: `${outside}/a` }, ...keep('write', `${outside}/a/old.txt`, `${outside}/a`, outside) },
    ])
  })

  it('a_write_may_be_kept_for_its_file_ahead_of_the_directory_holding_it', () => {
    const asked = (toolName: string, input: unknown) => {
      const shown = policy().decorate({ type: 'permission_request', requestId: 'r', toolName, input })
      return shown.type === 'permission_request' ? shown.commands : undefined
    }
    expect(asked('Edit', { file_path: `${outside}/a/b.ts` })?.[0]).toMatchObject(tool('Edit', 'write', `${outside}/a/b.ts`, `${outside}/a`, outside))
    // A read has no file to keep, and two files in one directory leave the directory alone.
    expect(asked('Read', { file_path: `${outside}/a/b.ts` })?.[0]?.places?.[0]?.directory).toBe(`${outside}/a`)
    expect(lines(`rm ${outside}/a/x.txt ${outside}/a/y.txt`)?.[0]?.places?.[0]?.directory).toBe(`${outside}/a`)
  })

  it('a_write_directly_in_the_home_folder_keeps_nothing_beyond_the_file_itself', () => {
    expect(lines(`rm ${home}/notes.txt`)?.[0]?.places?.map((p) => p.directory)).toEqual([`${home}/notes.txt`])
    expect(lines(`cat ${home}/notes.txt`)?.[0]).toMatchObject({ access: { kind: 'reads', directory: home } })
    expect(lines(`cat ${home}/notes.txt`)?.[0]?.places).toBeUndefined()
  })

  it('a_file_tool_is_asked_about_as_the_directory_holding_the_file_it_reaches', () => {
    const asked = (toolName: string, input: unknown) => {
      const shown = policy().decorate({ type: 'permission_request', requestId: 'r', toolName, input })
      return shown.type === 'permission_request' ? shown.commands : undefined
    }
    expect(asked('Read', { file_path: `${outside}/a/b.ts` })).toEqual([
      { text: `Read ${outside}/a`, access: { kind: 'reads', directory: `${outside}/a` }, ...tool('Read', 'read', `${outside}/a`, outside) },
    ])
    expect(asked('Edit', { file_path: `${outside}/a/b.ts` })?.[0]).toMatchObject({ access: { kind: 'writes', directory: `${outside}/a` } })
    expect(asked('Read', { file_path: 'src/a.ts' })).toBeUndefined()
  })

  it('running_a_program_of_its_own_is_asked_about_as_before_with_no_directory_to_keep', () => {
    const command = `find ${outside} -exec rm {} ;`
    const [only, ...rest] = lines(command) ?? []
    expect(rest).toEqual([])
    expect(Object.keys(only!)).toEqual(['text'])
  })

  it('a_call_that_reads_and_writes_the_same_place_is_asked_about_as_a_write', () => {
    expect(lines(`cp ${outside}/a/x.txt ${outside}/a/y.txt`)).toMatchObject([{ access: { kind: 'writes', directory: `${outside}/a` } }])
  })

  it('a_relative_path_names_the_absolute_directory_from_where_the_shell_stands', () => {
    expect(lines('cat ../sibling/f.txt')?.[0]).toMatchObject({ access: { kind: 'reads', directory: `${parent}/sibling` } })
    expect(lines(`cd ${outside} && rm sub/f.txt`, [`Bash(cd ${outside})`])).toMatchObject([
      { passes: 'read-only' },
      { access: { kind: 'writes', directory: `${outside}/sub` } },
    ])
  })

  it('a_path_starting_at_the_home_folder_is_read_as_the_home_folder', () => {
    expect(lines('cat ~/.cargo/registry/x.txt')).toMatchObject([
      { access: { kind: 'reads', directory: `${home}/.cargo/registry` }, ...keep('read', `${home}/.cargo/registry`, `${home}/.cargo`) },
    ])
  })

  it('a_path_that_depends_on_something_unsettled_is_asked_every_time_with_nothing_to_keep', () => {
    expect(lines('cat $FILE')).toEqual([{ text: 'cat $FILE', access: { kind: 'reads' } }])
    expect(lines('rm $FILE')).toEqual([{ text: 'rm $FILE', access: { kind: 'writes' } }])
    // A change of directory that may not have run leaves every later relative path in doubt.
    expect(lines(`cd ${outside}; cat f.txt`)?.at(-1)).toEqual({ text: 'cat f.txt', access: { kind: 'reads' } })
  })

  it('a_wildcard_names_the_directories_above_it_and_only_those_are_offered_to_keep', () => {
    expect(lines(`cat ${outside}/a/*/f.txt`)).toMatchObject([
      { access: { kind: 'reads', directory: `${outside}/a` }, ...keep('read', `${outside}/a`, outside) },
    ])
  })

  it('a_line_missing_more_than_one_grant_asks_about_each_directory_and_kind_in_turn', () => {
    expect(lines(`cp ${outside}/src/x.txt ${outside}/dst/y.txt`)).toMatchObject([
      { access: { kind: 'reads', directory: `${outside}/src` } },
      { access: { kind: 'writes', directory: `${outside}/dst` } },
    ])
  })

  it('a_directory_kept_for_reading_lets_the_command_read_beneath_it_unasked', async () => {
    const use = (p: PermissionPolicy, command: string) => p.preToolUse({ toolName: 'Bash', input: { command }, toolUseId: 't' })
    expect(await use(policy([`Bash(read ${outside}/a)`]), `cat ${outside}/a/deep/b.txt`)).toEqual({ allow: true })
    expect(await use(policy([`Bash(read ${outside}/a)`]), `cat ${outside}/b/b.txt`)).toBeUndefined()
    expect(await use(policy([`Bash(write ${outside}/a)`]), `rm ${outside}/a/x.txt ${outside}/a/y.txt`)).toEqual({ allow: true })
  })

  function tool(name: string, verb: string, ...directories: string[]) {
    return {
      rule: `${name}(${verb} ${directories[0]})`,
      places: directories.map((directory) => ({ directory, rule: `${name}(${verb} ${directory})` })),
      scope: 'person',
    }
  }
})
