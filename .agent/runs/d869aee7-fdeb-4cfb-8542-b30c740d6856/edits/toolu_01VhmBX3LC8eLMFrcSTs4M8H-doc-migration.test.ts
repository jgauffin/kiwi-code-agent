import { describe, expect, it } from 'vitest'
import { ASK_USER_TOOL } from '../src/agent/openai-session/tools/ask-user'
import { DOC_MIGRATION_TOOLS, docMigrationPrompt, docMigrationScope } from '../src/agent/phases/doc-migration'
import { ScopeGuard } from '../src/agent/phases/scope-guard'

const cwd = process.platform === 'win32' ? 'D:\\work\\repo' : '/work/repo'
const guard = new ScopeGuard(cwd, docMigrationScope(['docs/api/**']))
const use = (toolName: string, input: unknown) => guard.preToolUse({ toolName, input, toolUseId: 't' })

describe('what a doc migration may touch', () => {
  it('maintenance_job_reads_the_docs_the_readme_and_the_specs_and_never_the_code', async () => {
    expect(await use('Read', { file_path: 'docs/intent/agent.md' })).toBeUndefined()
    expect(await use('Read', { file_path: 'ReadMe.md' })).toBeUndefined()
    expect(await use('Read', { file_path: 'plan/order-cancellation.spec.md' })).toBeUndefined()
    expect(await use('Read', { file_path: 'src/orders/cancel.ts' })).toMatchObject({ deny: expect.stringContaining('limited to docs/**') })
  })

  it('searching_is_allowed_only_where_reading_is_so_no_source_file_name_leaks', async () => {
    expect(await use('Glob', { pattern: '**/*.md', path: 'docs' })).toBeUndefined()
    expect(await use('Glob', { pattern: '*.spec.md', path: 'plan' })).toBeUndefined()
    expect(await use('Grep', { pattern: 'cancel', path: 'src' })).toMatchObject({ deny: expect.any(String) })
  })

  it('ignored_docs_from_the_plan_ignore_setting_are_denied_because_the_planner_cannot_see_them_either', async () => {
    expect(await use('Read', { file_path: 'docs/api/orders.md' })).toMatchObject({ deny: expect.stringContaining('docs/api/**') })
  })

  it('confirmed_doc_writes_fall_to_the_permission_prompt_rather_than_going_through_outright', async () => {
    // undefined is the ordinary prompt; the user confirms each cut to their own docs.
    expect(await use('Edit', { file_path: 'docs/intent/agent.md' })).toBeUndefined()
    expect(await use('Write', { file_path: 'docs/intent/new-area.md' })).toBeUndefined()
    expect(await use('Write', { file_path: 'plan/order-cancellation.spec.md' })).toMatchObject({ deny: expect.stringContaining('writes nothing') })
    expect(await use('Write', { file_path: 'src/orders/cancel.ts' })).toMatchObject({ deny: expect.stringContaining('writes nothing') })
  })

  it('bash_is_denied_by_name_so_the_scope_cannot_be_walked_around', async () => {
    expect(await use('Bash', { command: 'cat src/orders/cancel.ts' })).toMatchObject({ deny: expect.stringContaining('not available in this phase') })
  })

  it('the_session_gets_the_tools_a_reader_and_a_confirmed_edit_need_and_no_others', () => {
    expect(DOC_MIGRATION_TOOLS).toEqual(['Read', 'Glob', 'MarkdownSearch', 'Write', 'Edit', ASK_USER_TOOL])
  })
})

describe('what a doc migration is told to judge', () => {
  const prompt = docMigrationPrompt(cwd)

  it('settled_specs_only_a_draft_spec_never_costs_a_doc_section', () => {
    expect(prompt).toContain('Only a settled spec counts.')
    expect(prompt).toContain('status approved or implemented')
    expect(prompt).toContain('a draft is still a proposal')
  })

  it('outline_before_judgment_the_first_pass_is_the_docs_map_and_judgment_is_per_section', () => {
    expect(prompt).toContain('Outline first, judge after.')
    expect(prompt).toContain('docs map above already outlines every doc')
    expect(prompt).toContain('never about a doc as a whole')
  })

  it('feature_content_decides_scope_not_the_file_or_folder_it_sits_in', () => {
    expect(prompt).toContain('A section is in scope only when its content describes product behaviour.')
    expect(prompt).toContain('Architecture, rationale, guidelines, a settings reference')
    expect(prompt).toContain('whatever file or folder it happens to sit in')
  })

  it('confirmed_doc_writes_every_write_is_put_to_the_user_first_one_at_a_time', () => {
    expect(prompt).toContain('Every write into `docs/**` is put to the user first')
    expect(prompt).toContain('made only once they say so, one write at a time')
  })

  it('setting_not_consulted_the_prompt_never_asks_about_cutCoveredDocs', () => {
    expect(prompt).toContain('kiwiAgent.cutCoveredDocs')
    expect(prompt).toContain('is not consulted here')
    // No parameter to switch behaviour on it, unlike the planner's own doc review after approval.
    expect(docMigrationPrompt).toHaveLength(1)
  })

  it('the_job_never_reads_code_at_any_point_not_even_once_it_moves_on_to_checking_a_spec', () => {
    expect(prompt).toContain('you never read the code, at any point in the job')
  })
})
