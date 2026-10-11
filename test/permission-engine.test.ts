import { describe, expect, it } from 'vitest'
import { judgeCall, type CallContext } from '../src/agent/permissions/judge-call'
import type { Ground } from '../src/agent/permissions/evaluator'
import { parseGrant, type KeptGrant } from '../src/agent/permissions/grants'
import { grantSentence } from '../src/agent/permissions/grant-sentence'
import { grantFromClaudeRule, grantFromOldRule } from '../src/agent/permissions/grant-formats'
import { classifyCommand } from '../src/agent/permissions/classifiers'
import { siteAt } from '../src/agent/permissions/shell-effects'
import { readOnlyTools } from '../src/agent/permissions/tool-classes'
import { known } from '../src/agent/permissions/effects'

const R = process.platform === 'win32' ? 'E:' : ''
const WS = `${R}/ws`
const HOME = `${R}/home/me`
const SCRATCH = `${WS}/.kiwi/scratch/s1`

type Setup = { grants?: KeptGrant[]; ground?: Partial<Ground>; files?: string[]; dirs?: string[] }

function context(setup: Setup = {}): CallContext {
  const files = new Set(setup.files ?? [])
  const dirs = new Set(setup.dirs ?? [])
  return {
    grants: setup.grants ?? [],
    ground: {
      workspace: WS,
      readable: [],
      scratch: SCRATCH,
      writesAllowed: false,
      ignored: (path) => path.startsWith(`${WS}/dist`),
      recoverable: () => false,
      trusted: (path) => path === `${WS}/package.json`,
      denyGitWrites: false,
      home: HOME,
      ...setup.ground,
    },
    home: HOME,
    exists: (path) => (files.has(path) ? 'file' : dirs.has(path) ? 'directory' : undefined),
    tools: { readOnly: (name) => name === 'TodoWrite' },
  }
}

const bash = (command: string, setup?: Setup, cwd = WS) => judgeCall('Bash', { command }, cwd, context(setup))
const tool = (name: string, input: unknown, setup?: Setup) => judgeCall(name, input, WS, context(setup))

describe('what a call would do', () => {
  it('a_read_inside_the_workspace_runs_unasked', () => {
    expect(bash('cat src/a.ts | grep foo').decision).toBe('passes')
    expect(tool('Read', { file_path: `${WS}/src/a.ts` }).decision).toBe('passes')
  })

  it('a_command_touching_nothing_runs_unasked_wherever_the_shell_stands', () => {
    expect(bash('echo hi && pwd', {}, `${R}/elsewhere`).decision).toBe('passes')
  })

  it('a_path_held_in_a_variable_is_an_unknown_place_answered_for_the_call_alone', () => {
    const judged = bash('grep -rn "pub enum" $T')
    expect(judged.decision).toBe('asked')
    const row = judged.rows.find((r) => r.verdict === 'asked')!
    expect(row.does).toContain('$T')
    expect(row.keep?.allowNever).toBeDefined()
  })

  it('flags_written_in_any_form_read_the_same', () => {
    const site = siteAt(known(WS), { exists: () => undefined })
    const a = classifyCommand('grep', ['-rn', 'x', '.'], site).invocation
    const b = classifyCommand('grep', ['-n', '--recursive', 'x', '.'], site).invocation
    expect([...a.flags].sort()).toEqual([...b.flags].sort())
    const rm1 = classifyCommand('rm', ['-rf', 'x'], site).invocation
    const rm2 = classifyCommand('rm', ['--force', '-r', 'x'], site).invocation
    expect([...rm1.flags].sort()).toEqual([...rm2.flags].sort())
  })

  it('a_flag_taking_no_value_in_one_reader_never_swallows_the_path_after_it', () => {
    const OUT = `${R}/other`
    for (const line of [`wc -c ${OUT}/a.md`, `cat -n ${OUT}/a.md`, `tail -f ${OUT}/a.log`, `wc -w ${OUT}/a.md`, `stat -f ${OUT}/a.md`, `cut -s -f1 ${OUT}/a.csv`]) {
      expect(bash(line).rows.map((r) => r.does), line).toContain(`Reads ${OUT}/${line.split('/').pop()}`)
    }
    // Where the letter does take a value, the value is not taken for a path.
    expect(bash(`head -c 10 ${OUT}/a.md`).rows.map((r) => r.does)).toEqual([`Reads ${OUT}/a.md`])
  })

  it('a_place_another_asked_row_already_reaches_is_not_asked_beside_it', () => {
    const OUT = `${R}/other/docs`
    const judged = bash(`ls -R ${OUT}; wc -c ${OUT}/* ${OUT}/../readme.md`, { dirs: [OUT] })
    expect(judged.rows.map((r) => r.does)).toEqual([`Reads ${OUT} and below`, `Reads ${R}/other/readme.md`])
    // A delete is always asked, so a wider read never stands in for it.
    expect(bash(`ls -R ${OUT}; rm ${OUT}/a.md`).rows.map((r) => r.does)).toEqual([`Reads ${OUT} and below`, `Deletes or replaces ${OUT}/a.md`])
  })

  it('a_search_whose_glob_names_folders_reads_only_those', () => {
    const SUITE = `${R}/suite`
    const judged = tool('Grep', { pattern: 'x', path: SUITE, glob: '{a,ws}/{docs,specs}/**/*.md' }, { ground: { workspace: `${SUITE}/ws` } })
    expect(judged.rows.filter((r) => r.verdict === 'asked').map((r) => r.does)).toEqual([`Reads ${SUITE}/a/docs and below`, `Reads ${SUITE}/a/specs and below`])
    // A glob naming no folder, or one climbing out, narrows nothing.
    expect(tool('Grep', { pattern: 'x', path: SUITE, glob: '*.md' }).rows.map((r) => r.does)).toEqual([`Reads ${SUITE} and below`])
    expect(tool('Grep', { pattern: 'x', path: SUITE, glob: '{../x,a}/*.md' }).rows.map((r) => r.does)).toEqual([`Reads ${SUITE} and below`])
  })

  it('a_memory_note_is_written_unasked_where_the_session_is_told_to_keep_them_and_deleting_one_is_still_asked', () => {
    const MEMORY = `${HOME}/.claude/projects/ws/memory`
    const setup = { ground: { writable: [MEMORY, `${HOME}/.claude/CLAUDE.md`] } }
    expect(tool('Write', { file_path: `${MEMORY}/todo-notes.md`, content: '# x' }, setup).decision).toBe('passes')
    expect(tool('Edit', { file_path: `${HOME}/.claude/CLAUDE.md` }, setup).decision).toBe('passes')
    expect(bash(`rm ${MEMORY}/todo-notes.md`, { ...setup, files: [`${MEMORY}/todo-notes.md`] }).decision).toBe('asked')
    expect(tool('Write', { file_path: `${HOME}/.claude/settings.json`, content: '{}' }, setup).decision).toBe('asked')
  })

  it('a_brace_never_hides_where_a_path_reaches', () => {
    expect(tool('Glob', { pattern: '{/etc,src}/*' }).decision).toBe('asked')
    expect(tool('Glob', { pattern: '{a,b}/*.ts' }).decision).toBe('passes')
    expect(bash('cat {a,/etc/passwd}').decision).toBe('asked')
  })

  it('whether_a_path_exists_is_covered_by_whatever_lets_its_folder_be_read', () => {
    const grants: KeptGrant[] = [{ verdict: 'allow', action: 'read', place: `${R}/data`, reach: 'directory', scope: 'workspace' }]
    expect(tool('Exists', { path: `${R}/data/sub` }, { grants, dirs: [`${R}/data/sub`] }).decision).toBe('passes')
    expect(tool('Exists', { path: `${R}/data/missing.txt` }, { grants }).decision).toBe('passes')
    expect(tool('Exists', { path: `${R}/other/a.txt` }, { grants }).decision).toBe('asked')
  })

  it('starting_a_subagent_runs_unasked_and_its_own_calls_are_judged_each_on_its_own', () => {
    expect(tool('Agent', { description: 'Evaluate', subagent_type: 'general-purpose', prompt: 'x' }).decision).toBe('passes')
    expect(tool('Task', { description: 'Evaluate', prompt: 'x' }).decision).toBe('passes')
  })

  it('the_engines_own_bookkeeping_and_coordination_tools_run_unasked', () => {
    const ctx = { ...context(), tools: { readOnly: readOnlyTools(() => []) } }
    for (const [name, input] of [
      ['ToolSearch', { query: 'select:SendMessage', max_results: 1 }],
      ['ListAgents', {}],
      ['SendMessage', { to: 'reviewer', message: 'done' }],
      ['ScheduleWakeup', { delaySeconds: 600, prompt: 'check' }],
      ['TaskOutput', { task_id: 't1' }],
    ] as const) {
      expect(judgeCall(name, input, WS, ctx).decision, name).toBe('passes')
    }
    // Work beyond the session is still asked.
    expect(judgeCall('CronCreate', { cron: '* * * * *', prompt: 'x' }, WS, ctx).decision).toBe('asked')
    expect(judgeCall('EnterWorktree', { name: 'x' }, WS, ctx).decision).toBe('asked')
  })

  it('an_unknown_command_is_asked_and_a_kept_command_answer_covers_it', () => {
    expect(bash('frobnicate --all').decision).toBe('asked')
    const grants: KeptGrant[] = [{ verdict: 'allow', command: ['frobnicate'], place: WS, reach: 'tree', scope: 'workspace' }]
    expect(bash('frobnicate --all', { grants }).decision).toBe('passes')
  })

  it('a_read_kept_for_a_folder_covers_the_shell_and_the_file_tools_alike', () => {
    const grants: KeptGrant[] = [{ verdict: 'allow', action: 'read', place: `${HOME}/.cargo`, reach: 'tree', scope: 'person' }]
    expect(bash(`grep -rn foo ${HOME}/.cargo/registry`, { grants }).decision).toBe('passes')
    expect(tool('Read', { file_path: `${HOME}/.cargo/registry/x.rs` }, { grants }).decision).toBe('passes')
    expect(tool('Read', { file_path: `${HOME}/other/x.rs` }, { grants }).decision).toBe('asked')
  })
})

describe('destroy is not write', () => {
  it('deleting_is_asked_every_time_even_with_allow_writes_on', () => {
    const judged = bash('rm -rf src/old', { ground: { writesAllowed: true } })
    expect(judged.decision).toBe('asked')
    expect(judged.rows[0]!.keep?.allowNever).toContain('always asked')
  })

  it('replacing_an_existing_file_with_a_redirect_is_a_destroy_and_appending_is_a_write', () => {
    const setup: Setup = { ground: { writesAllowed: true }, files: [`${WS}/out.log`] }
    expect(bash('npm test > out.log', setup).rows.some((r) => r.does.startsWith('Deletes or replaces'))).toBe(true)
    expect(bash('npm test >> out.log', setup).rows.every((r) => !r.does.startsWith('Deletes'))).toBe(true)
    expect(bash('npm test > new.log', setup).rows.every((r) => !r.does.startsWith('Deletes'))).toBe(true)
  })

  it('a_destroy_in_the_scratch_folder_or_in_ignored_output_is_judged_as_a_write', () => {
    expect(bash(`rm -rf ${SCRATCH}/tmp`).decision).toBe('passes')
    expect(bash('rm -rf dist', { ground: { writesAllowed: true } }).decision).toBe('passes')
    expect(bash('rm -rf dist').decision).toBe('asked')
  })

  it('xargs_handing_rm_its_paths_deletes_an_unknown_place', () => {
    const judged = bash('ls | xargs rm', { ground: { writesAllowed: true } })
    expect(judged.decision).toBe('asked')
    expect(judged.rows.some((r) => r.does.startsWith('Deletes') && r.does.includes('unknown place'))).toBe(true)
  })
})

describe('writing around the file tools is refused', () => {
  it.each(["sed -i 's/a/b/' x.ts", 'echo hi > a.txt', 'cat <<EOF > a.txt\nhello\nEOF', "perl -pi -e 's/a/b/' x", 'yq -i .a=1 x.yaml', "python -c \"open('a','w').write('x')\"", 'tee a.txt'])(
    'refuses_%s',
    (command) => {
      expect(bash(command, { ground: { writesAllowed: true } }).decision).toBe('refused')
    },
  )

  it('a_programs_own_output_redirected_to_a_file_is_a_write_not_a_refusal', () => {
    expect(bash(`cargo test > ${SCRATCH}/out.log`, { grants: [{ verdict: 'allow', command: ['cargo', 'test'], place: WS, reach: 'tree', scope: 'workspace' }] }).decision).toBe('passes')
  })

  it('a_sed_that_only_prints_reads', () => {
    expect(bash("sed -n '1,20p' src/a.ts").decision).toBe('passes')
  })
})

describe('where the shell stands', () => {
  it('changing_directory_asks_nothing_and_moves_where_the_rest_is_judged_from', () => {
    const judged = bash(`cd ${HOME}/data && cat raw.csv`)
    expect(judged.rows[0]!.verdict).toBe('passes')
    expect(judged.rows[1]!.does).toBe(`Reads ${HOME}/data/raw.csv`)
    expect(judged.rows[1]!.verdict).toBe('asked')
  })

  it('a_change_of_directory_into_a_read_denied_directory_refuses_the_line', () => {
    const grants: KeptGrant[] = [{ verdict: 'deny', action: 'read', place: `${HOME}/secrets`, reach: 'tree', scope: 'person' }]
    expect(bash(`cd ${HOME}/secrets && echo hi`, { grants }).decision).toBe('refused')
  })

  it('the_shell_s_directory_from_an_earlier_call_is_where_a_relative_path_is_read_from', () => {
    expect(bash('cat key.pem', {}, `${HOME}/secrets`).rows[0]!.does).toBe(`Reads ${HOME}/secrets/key.pem`)
  })

  it('after_an_untracked_change_of_directory_relative_paths_are_unknown', () => {
    const judged = bash('cd $X && cat a.txt')
    expect(judged.rows.find((r) => r.text.startsWith('cat'))!.does).toContain('unknown place')
  })

  it('a_change_of_directory_in_a_subshell_leaves_the_rest_where_it_was', () => {
    const judged = bash(`(cd ${HOME}/x && ls) ; cat a.txt`)
    expect(judged.rows.find((r) => r.text.startsWith('cat'))!.verdict).toBe('passes')
  })
})

describe('keeping an answer', () => {
  it('a_denial_wins_over_an_allow_whatever_scope_either_is_kept_in', () => {
    const grants: KeptGrant[] = [
      { verdict: 'allow', action: 'read', place: HOME, reach: 'tree', scope: 'session' },
      { verdict: 'deny', action: 'read', place: `${HOME}/secrets`, reach: 'tree', scope: 'workspace' },
    ]
    expect(bash(`cat ${HOME}/secrets/a`, { grants }).decision).toBe('refused')
    expect(bash(`cat ${HOME}/notes/a`, { grants }).decision).toBe('passes')
  })

  it('a_read_denial_refuses_writes_and_a_write_denial_still_reads', () => {
    const readDenied: KeptGrant[] = [{ verdict: 'deny', action: 'read', place: `${R}/data`, reach: 'tree', scope: 'person' }]
    expect(tool('Write', { file_path: `${R}/data/a.txt` }, { grants: readDenied }).decision).toBe('refused')
    const writeDenied: KeptGrant[] = [
      { verdict: 'deny', action: 'write', place: `${R}/data`, reach: 'tree', scope: 'person' },
      { verdict: 'allow', action: 'read', place: `${R}/data`, reach: 'tree', scope: 'person' },
    ]
    expect(tool('Read', { file_path: `${R}/data/a.txt` }, { grants: writeDenied }).decision).toBe('passes')
    expect(tool('Write', { file_path: `${R}/data/a.txt` }, { grants: writeDenied }).decision).toBe('refused')
  })

  it('a_command_denial_naming_flags_refuses_only_calls_carrying_them', () => {
    const grants: KeptGrant[] = [
      { verdict: 'allow', command: ['git'], place: WS, reach: 'tree', scope: 'workspace' },
      { verdict: 'deny', command: ['git', 'push'], flags: ['--force'], place: WS, reach: 'tree', scope: 'workspace' },
    ]
    expect(bash('git push -f origin main', { grants }).decision).toBe('refused')
    expect(bash('git push origin main', { grants }).decision).toBe('passes')
  })

  it('a_directory_reach_covers_its_files_but_not_the_folders_below', () => {
    const grants: KeptGrant[] = [{ verdict: 'allow', action: 'read', place: `${R}/data`, reach: 'directory', scope: 'session' }]
    expect(tool('Read', { file_path: `${R}/data/a.txt` }, { grants }).decision).toBe('passes')
    expect(tool('Read', { file_path: `${R}/data/sub/a.txt` }, { grants }).decision).toBe('asked')
  })

  it('writes_in_the_workspace_follow_allow_writes', () => {
    expect(tool('Write', { file_path: `${WS}/a.ts` }).decision).toBe('asked')
    expect(tool('Write', { file_path: `${WS}/a.ts` }, { ground: { writesAllowed: true } }).decision).toBe('passes')
    expect(tool('Write', { file_path: `${SCRATCH}/a.ts` }).decision).toBe('passes')
  })

  it('a_write_to_a_file_deciding_what_runs_is_always_asked', () => {
    const judged = tool('Edit', { file_path: `${WS}/package.json` }, { ground: { writesAllowed: true } })
    expect(judged.decision).toBe('asked')
    expect(judged.rows[0]!.keep?.allowNever).toBeDefined()
  })

  it('a_place_inside_the_workspace_is_kept_for_the_session_or_the_workspace_and_outside_for_any_scope', () => {
    expect(bash('frobnicate').rows[0]!.keep?.scopes).toEqual(['session', 'workspace'])
    const outside = tool('Read', { file_path: `${R}/data/a.txt` }).rows[0]!.keep!
    expect(outside.scopes).toEqual(['session', 'workspace', 'person'])
    expect(outside.places.map((p) => p.place)).toEqual([`${R}/data/a.txt`, `${R}/data`].map((p) => p.replace(/^e:/, 'E:')))
  })

  it('outside_the_workspace_a_folder_holding_it_is_offered_like_any_other', () => {
    const SUITE = `${R}/suite`
    const keep = tool('Grep', { pattern: 'x', path: SUITE }, { ground: { workspace: `${SUITE}/ws` } }).rows[0]!.keep!
    expect(keep.places.map((p) => p.place)).toEqual([SUITE])
  })

  it('no_answer_is_offered_for_the_home_folder_or_above_it', () => {
    const places = tool('Read', { file_path: `${HOME}/a.txt` }).rows[0]!.keep!.places.map((p) => p.place)
    expect(places).toEqual([`${HOME}/a.txt`])
  })

  it('git_writes_are_refused_while_turned_off_and_looking_still_runs', () => {
    const setup: Setup = { ground: { denyGitWrites: true, writesAllowed: true } }
    expect(bash('git status', setup).decision).toBe('passes')
    expect(bash('git commit -m x', setup).decision).toBe('refused')
  })

  it('project_commands_run_unasked', () => {
    const ctx = context()
    ctx.project = { scripts: new Set(['test']), verify: [] }
    expect(judgeCall('Bash', { command: 'npm test' }, WS, ctx).decision).toBe('passes')
  })
})

describe('answers kept in another form', () => {
  const origin = { workspace: WS, home: HOME, exists: () => undefined }

  it('an_old_answer_granting_a_directory_becomes_that_grant_and_a_command_prefix_is_dropped', () => {
    expect(grantFromOldRule(`Bash(read ${R}/data)`, 'allow', origin)).toEqual({ verdict: 'allow', action: 'read', place: `${R}/data`.replace(/^e:/, 'E:'), reach: 'tree' })
    expect(grantFromOldRule('Bash(grep -n:*)', 'allow', origin)).toBeUndefined()
    expect(grantFromOldRule(`Bash(cd ${R}/data)`, 'allow', origin)).toBeUndefined()
  })

  it('a_claude_rule_naming_a_command_and_subcommand_is_read_as_a_command_answer', () => {
    expect(grantFromClaudeRule('Bash(npm run:*)', 'allow', origin)).toMatchObject({ command: ['npm', 'run'], place: WS })
    expect(grantFromClaudeRule('Read(~/.cargo/**)', 'allow', origin)).toMatchObject({ action: 'read', place: `${HOME}/.cargo`, reach: 'tree' })
  })

  it('a_claude_allow_naming_a_flag_is_ignored_and_a_deny_keeps_it', () => {
    expect(grantFromClaudeRule('Bash(grep -n:*)', 'allow', origin)).toBeUndefined()
    expect(grantFromClaudeRule('Bash(rm -rf:*)', 'deny', origin)).toMatchObject({ command: ['rm'], flags: expect.arrayContaining(['--recursive', '--force']) })
  })
})

describe('the sentence an answer is kept as', () => {
  it('says_who_what_where_and_how_far', () => {
    expect(grantSentence({ verdict: 'allow', command: ['cargo', 'build'], place: 'D:/src/other', reach: 'tree' }, 'person')).toBe(
      'Every session in every workspace may run `cargo build`, with any flags, in D:/src/other and every folder below it without asking.',
    )
    expect(grantSentence({ verdict: 'deny', action: 'write', place: 'D:/data', reach: 'directory' }, 'session')).toBe(
      'This session is refused when it would write files in D:/data (not the folders below it).',
    )
  })

  it('an_answer_tied_to_one_workspace_names_it_and_keeps_the_tie_when_read_back', () => {
    const stored = parseGrant({ verdict: 'allow', action: 'read', place: 'D:/src/other', reach: 'tree', workspace: 'd:\\src\\ws' })!
    expect(stored.workspace).toBe('D:/src/ws')
    expect(grantSentence(stored, 'person')).toBe('Every session in the workspace D:/src/ws may read files in D:/src/other and every folder below it without asking.')
  })
})
