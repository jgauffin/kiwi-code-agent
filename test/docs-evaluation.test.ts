import { describe, expect, it } from 'vitest'
import { ASK_USER_TOOL } from '../src/agent/openai-session/tools/ask-user'
import { DOCS_EVALUATION_TOOLS, docsEvaluationPrompt, docsEvaluationScope } from '../src/agent/phases/docs-evaluation'
import { ScopeGuard } from '../src/agent/phases/scope-guard'

const cwd = process.platform === 'win32' ? 'D:\\work\\repo' : '/work/repo'
const guard = new ScopeGuard(cwd, docsEvaluationScope(['docs/api/**']))
const use = (toolName: string, input: unknown) => guard.preToolUse({ toolName, input, toolUseId: 't' })

describe('what a docs evaluation may touch', () => {
  it('docs_the_readme_and_the_specs_are_readable_and_source_is_not', async () => {
    expect(await use('Read', { file_path: 'docs/intent/agent.md' })).toBeUndefined()
    expect(await use('Read', { file_path: 'ReadMe.md' })).toBeUndefined()
    expect(await use('Read', { file_path: 'plan/order-cancellation.spec.md' })).toBeUndefined()
    expect(await use('Read', { file_path: 'src/orders/cancel.ts' })).toMatchObject({ deny: expect.stringContaining('limited to docs/**') })
  })

  it('the_mappers_files_are_denied_so_nothing_that_read_the_code_reaches_the_evaluation', async () => {
    // Both were written by a run that read the source; a suggestion drawn from them
    // would put the code's shape back into the one input meant to be free of it.
    expect(await use('Read', { file_path: 'plan/order-cancellation.tasks.md' })).toMatchObject({ deny: expect.any(String) })
    expect(await use('Read', { file_path: 'plan/order-cancellation.decisions.md' })).toMatchObject({ deny: expect.any(String) })
  })

  it('searching_is_allowed_only_where_reading_is_so_no_file_names_leak', async () => {
    expect(await use('Glob', { pattern: '**/*.md', path: 'docs' })).toBeUndefined()
    expect(await use('Glob', { pattern: '*.spec.md', path: 'plan' })).toBeUndefined()
    expect(await use('Grep', { pattern: 'cancel', path: 'src' })).toMatchObject({ deny: expect.any(String) })
  })

  it('ignored_docs_from_the_plan_ignore_setting_are_denied_because_the_planner_cannot_see_them_either', async () => {
    expect(await use('Read', { file_path: 'docs/api/orders.md' })).toMatchObject({ deny: expect.stringContaining('docs/api/**') })
  })

  it('nothing_is_written_outright_and_a_docs_write_falls_to_the_permission_prompt', async () => {
    // undefined is the ordinary prompt; the user confirms each change to their own docs.
    expect(await use('Edit', { file_path: 'docs/intent/agent.md' })).toBeUndefined()
    expect(await use('Write', { file_path: 'docs/intent/new-area.md' })).toBeUndefined()
    expect(await use('Write', { file_path: 'plan/order-cancellation.spec.md' })).toMatchObject({ deny: expect.stringContaining('writes nothing') })
    expect(await use('Write', { file_path: 'src/orders/cancel.ts' })).toMatchObject({ deny: expect.stringContaining('writes nothing') })
  })

  it('bash_is_denied_by_name_so_the_scope_cannot_be_walked_around', async () => {
    expect(await use('Bash', { command: 'cat src/orders/cancel.ts' })).toMatchObject({ deny: expect.stringContaining('not available in this phase') })
  })

  it('the_session_gets_the_tools_a_reader_and_an_asked_for_edit_need_and_no_others', () => {
    expect(DOCS_EVALUATION_TOOLS).toEqual(['Read', 'Glob', 'Write', 'Edit', ASK_USER_TOOL])
  })
})

describe('what a docs evaluation is told to judge', () => {
  const prompt = docsEvaluationPrompt(cwd)

  it('the_prompt_asks_about_discovery_and_says_completeness_is_not_the_measure', () => {
    expect(prompt).toContain('what a planner cannot find')
    expect(prompt).toContain('to the point, not complete')
  })

  it('the_prompt_forbids_renaming_a_heading_an_approved_spec_cites_without_naming_the_citations', () => {
    // The one failure here that no build, test or view would report.
    expect(prompt).toContain('load-bearing')
    expect(prompt).toContain('name every citation that would have to follow')
    expect(prompt).toContain('the parts keep the headings they had')
  })

  it('the_prompt_writes_nothing_until_the_user_picks_and_says_an_empty_list_is_a_good_result', () => {
    expect(prompt).toContain('Write nothing.')
    expect(prompt).toContain('each write is confirmed by them')
    expect(prompt).toContain('an empty list is a good result')
  })

  it('the_prompt_names_no_output_file_because_the_findings_are_said_in_chat', () => {
    expect(prompt).toContain('Say it in chat, one line per finding')
    expect(prompt).not.toContain('.review.md')
    expect(prompt).not.toContain('findings file')
  })
})
