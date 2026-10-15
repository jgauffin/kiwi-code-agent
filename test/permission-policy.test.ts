import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { instructionPlaces } from '../src/agent/permissions/instruction-places'
import { projectMemoryDir } from '../src/agent/memory/memories'
import { PermissionPolicy, type PolicyContext } from '../src/agent/permissions/permission-policy'
import type { KeptGrant } from '../src/agent/permissions/grants'
import { normalizePlace } from '../src/agent/permissions/places'
import { readOnlyTools } from '../src/agent/permissions/tool-classes'
import { reviewEdits } from '../src/agent/permissions/gate'
import { ASK_USER_TOOL } from '../src/agent/openai-session/tools/ask-user'
import { BLIND_PLAN_TOOLS, blindPlanPrompt } from '../src/agent/phases/blind-plan'
import { IMPLEMENT_TOOLS, implementPrompt } from '../src/agent/phases/implement'
import { RECONCILE_TOOLS } from '../src/agent/phases/reconcile'

const cwd = process.platform === 'win32' ? 'D:\\work\\repo' : '/work/repo'
const root = normalizePlace(cwd)
const outside = process.platform === 'win32' ? 'E:/elsewhere' : '/elsewhere'
const ASKED = { ask: true }

const readOnly = readOnlyTools(() => [{ name: ASK_USER_TOOL, readOnly: true }])

/** A policy over these kept answers; git is never consulted, so no test depends on the machine's repository. */
function policy(grants: KeptGrant[] = [], context: PolicyContext & { denyGitWrites?: boolean } = {}): PermissionPolicy {
  const { denyGitWrites, ...rest } = context
  return new PermissionPolicy(cwd, () => ({ grants, denyGitWrites: denyGitWrites ?? false }), { readOnly, ignored: () => false, recoverable: () => false, ...rest })
}

const use = (p: PermissionPolicy, toolName: string, input: unknown, at?: string) => p.preToolUse({ toolName, input, toolUseId: 't', ...(at ? { cwd: at } : {}) })

const keep = (grant: Omit<KeptGrant, 'scope'>, scope: KeptGrant['scope'] = 'workspace'): KeptGrant => ({ ...grant, scope })

describe('PermissionPolicy', () => {
  it('read_only_tools_and_commands_that_only_look_in_the_workspace_pass_without_a_prompt', async () => {
    const p = policy()
    expect(await use(p, 'Read', { file_path: 'src/a.ts' })).toEqual({ allow: true })
    expect(await use(p, 'Grep', { pattern: 'x' })).toEqual({ allow: true })
    expect(await use(p, 'MarkdownSearch', { query: 'x', path: 'docs' })).toEqual({ allow: true })
    expect(await use(p, 'Bash', { command: 'git status && ls' })).toEqual({ allow: true })
    expect(await use(p, 'PowerShell', { command: 'git status; ls' })).toEqual({ allow: true })
    expect(await use(p, ASK_USER_TOOL, { questions: [{ header: 'Storage', question: 'Where?' }] })).toEqual({ allow: true })
  })

  it('a_call_the_rules_leave_open_is_asked_explicitly_so_the_engine_s_own_rules_cannot_let_it_past', async () => {
    expect(await use(policy(), 'Bash', { command: 'frobnicate' })).toEqual(ASKED)
  })

  it('looking_outside_the_workspace_is_asked_and_a_kept_read_covers_every_tool_alike', async () => {
    const p = policy()
    for (const [tool, input] of [
      ['Read', { file_path: `${outside}/.ssh/id_rsa` }],
      ['Read', { file_path: '../sibling/src/a.ts' }],
      ['CodeSearch', { query: 'x', path: '../sibling' }],
      ['ReadDir', { path: outside }],
      ['Glob', { pattern: '../sibling/**/*.ts' }],
      ['Bash', { command: `cat ${outside}/notes.md` }],
    ] as const)
      expect(await use(p, tool, input), tool).toEqual(ASKED)
    const kept = policy([keep({ verdict: 'allow', action: 'read', place: outside, reach: 'tree' }, 'person')])
    expect(await use(kept, 'Read', { file_path: `${outside}/notes.md` })).toEqual({ allow: true })
    expect(await use(kept, 'ReadDir', { path: `${outside}/logs` })).toEqual({ allow: true })
    expect(await use(kept, 'Bash', { command: `grep -rn x ${outside}` })).toEqual({ allow: true })
  })

  it('a_sessions_own_instructions_are_read_without_a_prompt_wherever_they_are_kept_and_written_with_one', async () => {
    const home = process.platform === 'win32' ? 'D:\\home\\jonas' : '/home/jonas'
    const p = policy([], { readable: instructionPlaces(cwd, [], home), home })
    const skill = join(home, '.claude', 'skills', 'spec-writing')
    expect(await use(p, 'Skill', { skill: 'spec-writing' })).toEqual({ allow: true })
    expect(await use(p, 'Read', { file_path: join(skill, 'SKILL.md') })).toEqual({ allow: true })
    expect(await use(p, 'Glob', { pattern: join(skill, 'templates', '*.md') })).toEqual({ allow: true })
    expect(await use(p, 'Bash', { command: `cat ${skill.split('\\').join('/')}/SKILL.md` })).toEqual({ allow: true })
    expect(await use(p, 'Read', { file_path: join(home, '.kiwi', 'agents', 'reviewer.md') })).toEqual({ allow: true })
    expect(await use(p, 'Read', { file_path: join(projectMemoryDir(cwd, home), 'no-git-commands.md') })).toEqual({ allow: true })
    expect(await use(p, 'Read', { file_path: join(home, 'AGENTS.md') })).toEqual({ allow: true })
    // Nothing else of the person's opens up alongside them.
    expect(await use(p, 'Read', { file_path: join(home, '.claude', '.credentials.json') })).toEqual(ASKED)
    expect(await use(p, 'Read', { file_path: join(home, 'notes.md') })).toEqual(ASKED)
    // Writing there is a write like any other.
    expect(await use(p, 'Write', { file_path: join(skill, 'SKILL.md'), content: 'x' })).toEqual(ASKED)
  })

  it('a_call_is_judged_from_where_the_engine_says_its_shell_stands_and_its_prompt_from_the_same_place', async () => {
    const p = policy()
    const elsewhere = `${outside}/secrets`
    expect(await use(p, 'Bash', { command: 'cat key.pem' }, elsewhere)).toEqual(ASKED)
    const shown = p.decorate({ type: 'permission_request', requestId: 'r', toolUseId: 't', toolName: 'Bash', input: { command: 'cat key.pem' } })
    expect(shown.type === 'permission_request' ? shown.rows?.[0]?.does : undefined).toBe(`Reads ${elsewhere}/key.pem`)
  })

  it('a_prompt_lists_the_call_as_rows_saying_what_each_part_does_and_what_the_rules_make_of_it', () => {
    const shown = policy().decorate({ type: 'permission_request', requestId: 'r', toolName: 'Bash', input: { command: 'ls && rm -rf build' } })
    const rows = shown.type === 'permission_request' ? shown.rows : undefined
    expect(rows?.map((r) => [r.does, r.verdict])).toEqual([
      [`Reads ${root}`, 'passes'],
      [`Deletes or replaces ${root}/build and below`, 'asked'],
    ])
  })

  it('an_mcp_tool_asks_unless_a_kept_answer_names_it_or_its_whole_server_and_a_denial_wins', async () => {
    const tool = 'mcp__docs-server__json_query'
    expect(await use(policy(), tool, {})).toEqual(ASKED)
    const server = policy([keep({ verdict: 'allow', command: ['mcp__docs-server__*'], place: root, reach: 'tree' })])
    expect(await use(server, tool, {})).toEqual({ allow: true })
    expect(await use(server, 'mcp__docs-server__read_doc_file', {})).toEqual({ allow: true })
    expect(await use(server, 'mcp__docs-server-2__json_query', {})).toEqual(ASKED)
    const denied = policy([
      keep({ verdict: 'allow', command: [tool], place: root, reach: 'tree' }),
      keep({ verdict: 'deny', command: ['mcp__docs-server__*'], place: root, reach: 'tree' }),
    ])
    expect(await use(denied, tool, {})).toMatchObject({ deny: expect.stringContaining('mcp__docs-server__*') })
  })

  it('a_tool_denied_by_name_is_refused_even_where_it_only_reads', async () => {
    const p = policy([keep({ verdict: 'deny', command: ['Grep'], place: root, reach: 'tree' })])
    expect(await use(p, 'Grep', { pattern: 'x' })).toMatchObject({ deny: expect.stringContaining('Grep') })
  })

  it('a_delegation_to_the_research_sub_agent_is_asked_until_the_workspace_keeps_an_answer_for_it_and_no_other_is_asked', async () => {
    expect(await use(policy(), 'Delegate', { agent: 'research', task: 'look it up' })).toEqual(ASKED)
    const kept = policy([keep({ verdict: 'allow', command: ['Delegate', 'research'], place: root, reach: 'tree' })])
    expect(await use(kept, 'Delegate', { agent: 'research', task: 'look it up' })).toEqual({ allow: true })
    expect(await use(policy(), 'Delegate', { agent: 'retrieve', task: 'look it up' })).toEqual({ allow: true })
    expect(await use(policy(), 'Delegate', { define: { name: 'x', description: 'd', instructions: 'i' }, task: 'look it up' })).toEqual({ allow: true })
  })

  it('the_claude_engines_own_call_to_the_research_sub_agent_is_asked_and_covered_by_the_same_kept_answer', async () => {
    expect(await use(policy(), 'Agent', { subagent_type: 'research', prompt: 'look it up' })).toEqual(ASKED)
    const kept = policy([keep({ verdict: 'allow', command: ['Delegate', 'research'], place: root, reach: 'tree' })])
    expect(await use(kept, 'Agent', { subagent_type: 'research', prompt: 'look it up' })).toEqual({ allow: true })
    expect(await use(policy(), 'Agent', { subagent_type: 'Explore', prompt: 'look it up' })).toEqual({ allow: true })
  })

  it('searching_and_fetching_inside_an_approved_research_run_unasked_while_any_other_caller_is_asked', async () => {
    const p = policy()
    const inside = (toolName: string, input: unknown, agent: string) => p.preToolUse({ toolName, input, toolUseId: 't', agent })
    expect(await inside('WebFetch', { url: 'https://example.com', prompt: 'title' }, 'research')).toEqual({ allow: true })
    expect(await inside('WebSearch', { query: 'rfc 9110' }, 'research')).toEqual({ allow: true })
    expect(await inside('WebFetch', { url: 'https://example.com', prompt: 'title' }, 'general-purpose')).toEqual(ASKED)
    expect(await use(p, 'WebFetch', { url: 'https://example.com', prompt: 'title' })).toEqual(ASKED)
  })

  it('a_substitution_is_judged_by_the_commands_it_holds_and_a_command_word_it_supplies_is_always_asked', async () => {
    expect(await use(policy(), 'Bash', { command: 'echo "count: $(ls | wc -l)"' })).toEqual({ allow: true })
    const everything = keep({ verdict: 'allow', command: ['rm'], place: root, reach: 'tree' })
    expect(await use(policy([everything]), 'Bash', { command: '$(which rm) -rf x' })).toEqual(ASKED)
    // A denial reaches inside a substitution too.
    expect(await use(policy([keep({ verdict: 'deny', command: ['rm'], place: root, reach: 'tree' })]), 'Bash', { command: 'echo $(rm x)' })).toMatchObject({
      deny: expect.stringContaining('rm'),
    })
  })

  it('a_command_handed_a_program_to_run_is_asked_whatever_is_kept_for_the_command', async () => {
    const find = keep({ verdict: 'allow', command: ['find'], place: root, reach: 'tree' })
    expect(await use(policy([find]), 'Bash', { command: 'find . -exec rm {} \\;' })).toEqual(ASKED)
    expect(await use(policy(), 'Bash', { command: "sed '1e rm -rf x' f" })).toEqual(ASKED)
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
  const run = (command: string, grants: KeptGrant[] = [], toolName = 'Bash') => use(policy(grants, { denyGitWrites: true, writesAllowed: () => true }), toolName, { command })

  it('every_git_command_that_changes_the_repository_is_refused_however_it_is_run', async () => {
    for (const c of ['git commit -m x', 'git push', 'git stash', 'ls && git checkout main', 'timeout 30 git reset --hard', 'ls | xargs git branch -D', 'git config user.name x', 'git add .'])
      expect(await run(c), c).toMatchObject({ deny: expect.stringContaining('denyGitWrites') })
    expect(await run('git commit -m x', [], 'PowerShell')).toMatchObject({ deny: expect.stringContaining('denyGitWrites') })
  })

  it('a_kept_answer_does_not_let_a_git_write_through', async () => {
    expect(await run('git push', [keep({ verdict: 'allow', command: ['git'], place: root, reach: 'tree' })])).toMatchObject({ deny: expect.stringContaining('denyGitWrites') })
  })

  it('git_that_only_reads_runs_and_a_redirect_of_its_output_is_a_file_write_rather_than_a_git_write', async () => {
    for (const c of ['git status', 'git --no-pager diff', 'git -P log', 'git -C sub log --oneline', 'git config --get user.name']) expect(await run(c), c).toEqual({ allow: true })
    expect(await use(policy([], { denyGitWrites: true }), 'Bash', { command: 'git log > log.txt' })).toEqual(ASKED)
  })
})

describe('the Allow writes switch', () => {
  it('writes_in_the_workspace_pass_while_the_switch_is_on_and_writes_anywhere_else_are_still_asked', async () => {
    let on = false
    const p = policy([], { writesAllowed: () => on })
    expect(await use(p, 'Edit', { file_path: 'src/a.ts' })).toEqual(ASKED)
    on = true
    for (const tool of ['Write', 'Edit', 'MultiEdit']) expect(await use(p, tool, { file_path: 'src/a.ts' }), tool).toEqual({ allow: true })
    expect(await use(p, 'NotebookEdit', { notebook_path: 'src/a.ipynb' })).toEqual({ allow: true })
    expect(await use(p, 'Write', { file_path: '../other/a.ts' })).toEqual(ASKED)
    expect(await use(p, 'Bash', { command: 'npm test > out.log' })).toEqual(ASKED)
    expect(await use(p, 'Bash', { command: 'mkdir -p build/x && touch build/x/a' })).toEqual({ allow: true })
  })

  it('a_delete_git_can_bring_back_passes_under_the_switch_and_one_it_cannot_is_asked', async () => {
    const restorable = new Set([`${root}/old`])
    const p = policy([], { writesAllowed: () => true, recoverable: (path) => restorable.has(path) })
    expect(await use(p, 'Bash', { command: 'rm -rf old' })).toEqual({ allow: true })
    expect(await use(p, 'Bash', { command: 'rm -rf new-work' })).toEqual(ASKED)
    expect(await use(policy([], { writesAllowed: () => false, recoverable: () => true }), 'Bash', { command: 'rm -rf old' })).toEqual(ASKED)
  })

  it('a_write_to_a_file_that_decides_what_runs_unasked_is_always_asked', async () => {
    const p = policy([], { writesAllowed: () => true })
    for (const file of ['package.json', '.vscode/settings.json', '.mcp.json', 'repo.code-workspace', '.claude/settings.json']) expect(await use(p, 'Edit', { file_path: file }), file).toEqual(ASKED)
    expect(await use(p, 'RunScript', { files: ['src/a.ts', 'package.json'] })).toEqual(ASKED)
    expect(await use(p, 'Move', { source: 'package.json', destination: 'old.json' })).toEqual(ASKED)
    // Only the root package.json's scripts run unasked, so a nested one is an ordinary file.
    expect(await use(p, 'Edit', { file_path: 'frontend/package.json' })).toEqual({ allow: true })
  })

  it('a_write_to_where_the_persons_own_rules_are_kept_is_always_asked_whatever_is_kept_for_that_folder', async () => {
    const home = process.platform === 'win32' ? 'D:\\home\\jonas' : '/home/jonas'
    const kiwiDir = join(home, '.kiwi')
    const rulesFile = join(kiwiDir, 'permissions.json')
    const p = policy([keep({ verdict: 'allow', action: 'write', place: normalizePlace(kiwiDir), reach: 'tree' }, 'person')], { rulesFiles: [rulesFile] })
    expect(await use(p, 'Edit', { file_path: join(kiwiDir, 'notes.md') })).toEqual({ allow: true })
    expect(await use(p, 'Edit', { file_path: rulesFile })).toEqual(ASKED)
  })

  it('a_denial_still_refuses_a_write_to_a_trust_file', async () => {
    const p = policy([keep({ verdict: 'deny', action: 'write', place: `${root}/package.json`, reach: 'file' })], { writesAllowed: () => true })
    expect(await use(p, 'Edit', { file_path: 'package.json' })).toMatchObject({ deny: expect.stringContaining('package.json') })
  })

  it('the_changes_a_script_staged_pass_under_the_switch_and_the_review_asks_only_for_what_the_rules_leave_open', async () => {
    let on = false
    let asked = 0
    const ask = async () => (asked++, { kind: 'allow' } as const)
    const p = policy([keep({ verdict: 'deny', action: 'write', place: `${root}/config`, reach: 'tree' })], { writesAllowed: () => on })
    const review = (files: string[]) => reviewEdits(p, ask, { toolName: 'RunScript', input: { files }, toolUseId: 't' }, {})
    expect(await review(['src/a.ts'])).toEqual({ kind: 'allow' })
    expect(asked).toBe(1)
    on = true
    expect(await review(['src/a.ts'])).toEqual({ kind: 'allow' })
    expect(asked, 'the switch covers it, so the user is not asked again').toBe(1)
    expect(await review(['config/.env'])).toMatchObject({ kind: 'deny' })
    expect(asked, 'a denial answers without asking').toBe(1)
    expect(await use(p, 'RunScript', { files: ['src/a.ts', '../other/a.ts'] })).toEqual(ASKED)
  })

  it('a_move_or_copy_passes_under_the_switch_only_when_both_ends_are_in_the_workspace', async () => {
    const p = policy([], { writesAllowed: () => true })
    for (const tool of ['Move', 'Copy']) {
      expect(await use(p, tool, { source: 'src/a.ts', destination: `${cwd}/lib/a.ts` }), tool).toEqual({ allow: true })
      expect(await use(p, tool, { source: 'src/a.ts', destination: '../other/a.ts' }), tool).toEqual(ASKED)
      expect(await use(p, tool, { source: `${outside}/a.ts`, destination: 'src/a.ts' }), tool).toEqual(ASKED)
    }
    expect(await use(p, 'Bash', { command: 'cp src/a.ts src/b.ts' })).toEqual({ allow: true })
    expect(await use(p, 'Bash', { command: 'cp ../other/a.ts src/b.ts' })).toEqual(ASKED)
  })
})

describe('the scratch folder', () => {
  const scratch = '.kiwi/scratch/s1'

  it('writes_in_the_scratch_folder_pass_with_the_switch_off_and_writes_elsewhere_still_ask', async () => {
    const p = policy([], { scratch })
    expect(await use(p, 'Write', { file_path: `${scratch}/probe.ts` })).toEqual({ allow: true })
    expect(await use(p, 'Bash', { command: `ls > ${scratch}/out.log` })).toEqual({ allow: true })
    expect(await use(p, 'Bash', { command: `rm -rf ${scratch}/old` })).toEqual({ allow: true })
    expect(await use(p, 'Write', { file_path: 'src/a.ts' })).toEqual(ASKED)
  })

  it('a_denial_still_refuses_a_write_in_the_scratch_folder', async () => {
    const p = policy([keep({ verdict: 'deny', action: 'write', place: `${root}/.kiwi`, reach: 'tree' })], { scratch })
    expect(await use(p, 'Write', { file_path: `${scratch}/probe.ts` })).toMatchObject({ deny: expect.any(String) })
  })

  it('naming_the_scratch_folder_through_a_variable_the_line_sets_passes_like_naming_it_outright', async () => {
    const p = policy([], { scratch })
    expect(await use(p, 'Bash', { command: `S=${scratch}; ls > $S/out.log; tail -5 "$S/out.log"` })).toEqual({ allow: true })
    expect(await use(p, 'Bash', { command: `S=${scratch}; rm -rf $S/old` })).toEqual({ allow: true })
    expect(await use(p, 'Bash', { command: `false && S=${scratch}; rm -rf $S/` })).toEqual(ASKED)
  })

  it('running_a_script_from_the_scratch_folder_is_still_asked', async () => {
    expect(await use(policy([], { scratch }), 'Bash', { command: `node ${scratch}/probe.mjs` })).toEqual(ASKED)
  })
})
