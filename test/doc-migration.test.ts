import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { ASK_USER_TOOL } from '../src/agent/openai-session/tools/ask-user'
import { DOC_MIGRATION_TOOLS, docMigrationPrompt, docMigrationScope, draftFolders, specsWithWorkInFlight } from '../src/agent/phases/doc-migration'
import { ScopeGuard } from '../src/agent/phases/scope-guard'
import { board, task } from './task-board-fixture'
import { renderBoard } from '../src/agent/phases/tasks-file'
import { UNFILED_DECISIONS } from '../src/agent/phases/unfiled-decisions'

const cwd = process.platform === 'win32' ? 'D:\\work\\repo' : '/work/repo'
const guard = new ScopeGuard(cwd, docMigrationScope(['docs/api/**']))
const use = (toolName: string, input: unknown) => guard.preToolUse({ toolName, input, toolUseId: 't' })

describe('what a doc migration may touch', () => {
  it('maintenance_job_reads_the_docs_the_readme_and_the_specs_and_never_the_code', async () => {
    expect(await use('Read', { file_path: 'docs/intent/agent.md' })).toBeUndefined()
    expect(await use('Read', { file_path: 'ReadMe.md' })).toBeUndefined()
    expect(await use('Read', { file_path: 'specs/order-cancellation.spec.md' })).toBeUndefined()
    expect(await use('Read', { file_path: 'src/orders/cancel.ts' })).toMatchObject({ deny: expect.stringContaining('limited to docs/**') })
  })

  it('searching_is_allowed_only_where_reading_is_so_no_source_file_name_leaks', async () => {
    expect(await use('Glob', { pattern: '**/*.md', path: 'docs' })).toBeUndefined()
    expect(await use('Glob', { pattern: '*.spec.md', path: 'specs' })).toBeUndefined()
    expect(await use('Grep', { pattern: 'cancel', path: 'src' })).toMatchObject({ deny: expect.any(String) })
  })

  it('ignored_docs_from_the_plan_ignore_setting_are_denied_because_the_planner_cannot_see_them_either', async () => {
    expect(await use('Read', { file_path: 'docs/api/orders.md' })).toMatchObject({ deny: expect.stringContaining('docs/api/**') })
  })

  it('confirmed_doc_writes_fall_to_the_permission_prompt_rather_than_going_through_outright', async () => {
    // undefined is the ordinary prompt; the user confirms each cut to their own docs.
    expect(await use('Edit', { file_path: 'docs/intent/agent.md' })).toBeUndefined()
    expect(await use('Write', { file_path: 'docs/intent/new-area.md' })).toBeUndefined()
    // The README is among the docs tidied in stage three, so a fix picked there can be made where it was found.
    expect(await use('Edit', { file_path: 'ReadMe.md' })).toBeUndefined()
    expect(await use('Write', { file_path: 'src/orders/cancel.ts' })).toMatchObject({ deny: expect.stringContaining('limited to') })
  })

  it('the_mappers_files_are_denied_so_nothing_that_read_the_code_reaches_the_cleanup', async () => {
    expect(await use('Read', { file_path: '.kiwi/specs/order-cancellation.decisions.md' })).toMatchObject({ deny: expect.any(String) })
    expect(await use('Read', { file_path: '.kiwi/specs/order-cancellation.context.md' })).toMatchObject({ deny: expect.any(String) })
  })

  it('a_migrated_draft_is_written_straight_through_like_the_unfiled_file_since_it_is_the_jobs_own_deliverable', async () => {
    expect(await use('Write', { file_path: 'specs/order-cancellation.spec.md' })).toMatchObject({ allow: true })
    expect(await use('Edit', { file_path: 'specs/order-cancellation.spec.md' })).toMatchObject({ allow: true })
  })

  it('a_contradiction_the_person_rules_on_is_recorded_straight_into_the_unfiled_file_with_no_confirmation', async () => {
    // Unlike a doc cut, this is the job's own bookkeeping of a word the user already said.
    expect(await use('Edit', { file_path: 'specs/unfiled-decisions.md' })).toMatchObject({ allow: true })
    expect(await use('Write', { file_path: 'specs/unfiled-decisions.md' })).toMatchObject({ allow: true })
    expect(await use('Read', { file_path: 'specs/unfiled-decisions.md' })).toBeUndefined()
  })

  it('bash_is_denied_by_name_so_the_scope_cannot_be_walked_around', async () => {
    expect(await use('Bash', { command: 'cat src/orders/cancel.ts' })).toMatchObject({ deny: expect.stringContaining('not available in this phase') })
  })

  it('the_session_gets_the_tools_a_reader_and_a_confirmed_edit_need_and_no_others', () => {
    expect(DOC_MIGRATION_TOOLS).toEqual(['Read', 'Glob', 'MarkdownSearch', 'SpecSearch', 'Write', 'Edit', 'MultiEdit', 'Move', ASK_USER_TOOL])
  })

  it('a_picked_move_is_allowed_outright_into_a_folder_at_any_depth_but_a_move_from_outside_the_specs_is_not', async () => {
    const domainGuard = new ScopeGuard(cwd, docMigrationScope([], 'by-domain'))
    const domainUse = (toolName: string, input: unknown) => domainGuard.preToolUse({ toolName, input, toolUseId: 't' })
    expect(await domainUse('Move', { source: 'specs/order-cancellation.spec.md', destination: 'specs/orders/order-cancellation.spec.md' })).toMatchObject({ allow: true })
    expect(await domainUse('Move', { source: 'docs/intent/agent.md', destination: 'specs/orders/agent.spec.md' })).toMatchObject({ deny: expect.any(String) })
    expect(await domainUse('Move', { source: 'specs/orders/order-cancellation.spec.md', destination: 'specs/orders/returns/order-cancellation.spec.md' })).toMatchObject({
      allow: true,
    })
  })
})

describe('what a doc migration is told to judge', () => {
  const prompt = docMigrationPrompt(cwd)

  it('settled_specs_only_a_draft_spec_never_costs_a_doc_section', () => {
    expect(prompt).toContain('Only a settled spec counts.')
    expect(prompt).toContain('A spec the user has approved is what the product says, whatever stage its build has reached')
    expect(prompt).toContain('a draft is still a proposal')
  })

  it('outline_before_judgment_the_first_pass_is_the_docs_map_and_judgment_is_per_section', () => {
    expect(prompt).toContain('Outline first, judge after.')
    // The map is appended after the prompt, so the prompt never says it is above.
    expect(prompt).toContain('docs map in this prompt outlines every doc')
    expect(prompt).not.toContain('map above')
    expect(prompt).toContain('never about a doc as a whole')
  })

  it('feature_content_decides_scope_not_the_file_or_folder_it_sits_in', () => {
    expect(prompt).toContain('A section is in scope only when its content describes product behaviour.')
    expect(prompt).toContain('Architecture, rationale, guidelines, a settings reference')
    expect(prompt).toContain('whatever file or folder it happens to sit in')
  })

  it('confirmed_doc_writes_every_write_is_put_to_the_user_first_one_at_a_time', () => {
    expect(prompt).toContain('Every write into `docs/**` or the README, in any stage, is put to the user first')
    expect(prompt).toContain('made only once they say so, one write at a time')
  })

  it('a_setting_the_model_cannot_read_is_not_explained_to_it', () => {
    expect(prompt).not.toContain('kiwiAgent.cutCoveredDocs')
    // No parameter to switch behaviour on it, unlike the planner's own doc review after approval.
    expect(docMigrationPrompt).toHaveLength(1)
  })

  it('the_job_never_reads_code_at_any_point', () => {
    expect(prompt).toContain('you never read the code, at any point in the job')
  })

  it('the_goal_is_behaviour_in_specs_and_everything_else_in_findable_docs', () => {
    expect(prompt).toContain('every piece of product behaviour lives in a spec, and the docs hold everything else')
  })

  it('three_stages_in_order_each_proposing_before_writing_and_any_of_them_skippable', () => {
    const prune = prompt.indexOf('**Stage one, prune.**')
    const draft = prompt.indexOf('**Stage two, draft specs.**')
    const tidy = prompt.indexOf('**Stage three, tidy what stays.**')
    expect(prune).toBeGreaterThan(-1)
    expect(draft).toBeGreaterThan(prune)
    expect(tidy).toBeGreaterThan(draft)
    expect(prompt).toContain('Each stage proposes in chat and waits for the user\'s answer before anything is written')
    expect(prompt).toContain('The user may skip a stage or stop after any of them')
  })
})

describe('tidying what stays', () => {
  const prompt = docMigrationPrompt(cwd)

  it('the_measure_is_what_a_planner_can_find_and_cite_not_completeness_or_prose', () => {
    expect(prompt).toContain('how much it has to read before it finds an answer, and whether it can cite what it found')
    expect(prompt).toContain('not the prose, not whether the docs are right, not whether they are complete')
  })

  it('every_finding_kind_a_planner_pays_for_is_named', () => {
    for (const kind of ['a heading that does not say what is under it', 'a folder with no way in', 'a term the docs lean on but define nowhere', 'a passage a rule would want to cite that sits under no heading of its own']) {
      expect(prompt, kind).toContain(kind)
    }
  })

  it('a_heading_a_spec_cites_is_load_bearing_and_its_citations_are_found_with_spec_search', () => {
    // The one failure here that no build, test or view would report.
    expect(prompt).toContain('**Cited headings are load-bearing.**')
    expect(prompt).toContain('search the specs for it with SpecSearch')
    expect(prompt).toContain('name every citation that would have to follow')
  })

  it('the_editing_rules_sit_where_the_edit_is_made_so_a_split_keeps_its_headings', () => {
    expect(prompt).toContain('keep every cited heading as it stands unless the user said to change it knowing what it costs')
    expect(prompt).toContain('a doc that is split keeps its headings in its parts')
  })

  it('an_empty_list_is_a_good_result', () => {
    expect(prompt).toContain('which is a good result, not a failure')
  })
})

describe('pruning what a spec already says', () => {
  const prompt = docMigrationPrompt(cwd)

  it('covered_section_is_reported_with_the_spec_and_rules_and_offered_for_removal', () => {
    expect(prompt).toContain('**Covered section.**')
    expect(prompt).toContain('naming the spec and the rules that cover it, and offered for removal')
  })

  it('partly_covered_section_offers_only_the_covered_part_and_leaves_the_rest_standing', () => {
    expect(prompt).toContain('**Partly covered section.**')
    expect(prompt).toContain('leave the rest standing')
  })

  it('doc_left_empty_is_offered_for_deletion_with_its_index_entries_and_links', () => {
    expect(prompt).toContain('**Doc left empty.**')
    expect(prompt).toContain('together with the index entries and the links that point at it')
  })

  it('contradicting_section_is_reported_and_never_offered_for_removal', () => {
    expect(prompt).toContain('**Contradicting section.**')
    expect(prompt).toContain('never offered for removal: which side is current is the user\'s to say, not yours')
  })

  it('contradiction_the_person_rules_on_is_recorded_as_an_unfiled_decision_and_the_spec_is_untouched', () => {
    expect(prompt).toContain('**Contradiction the person rules on.**')
    expect(prompt).toContain('specs/unfiled-decisions.md')
    expect(prompt).toContain(UNFILED_DECISIONS)
    expect(prompt).toContain('The spec is not edited here.')
  })

  it('cited_section_kept_whole_names_the_citations_before_offering_removal', () => {
    expect(prompt).toContain('**Cited section kept whole.**')
    expect(prompt).toContain('do not offer the section without naming every citation that would have to change with it')
  })

  it('nothing_covered_says_so_and_goes_on_to_stage_two', () => {
    expect(prompt).toContain('**Nothing covered.**')
    expect(prompt).toContain('say so in chat and go on to stage two')
  })
})

describe('migrating the remaining feature docs into specs', () => {
  const prompt = docMigrationPrompt(cwd)

  it('offered_when_pruning_is_settled_the_migration_waits_on_every_reported_cut_having_an_answer', () => {
    expect(prompt).toContain('**Offered when pruning is settled.**')
    expect(prompt).toContain('Do not raise stage two while a covered section you reported is still waiting on the user')
  })

  it('feature_list_first_proposes_features_from_the_sections_left_standing_naming_where_each_comes_from', () => {
    expect(prompt).toContain('**Feature list first.**')
    expect(prompt).toContain('one line per feature you read out of the sections pruning left standing, naming the sections it comes from')
    expect(prompt).toContain('Wait for the user to say which become specs')
  })

  it('built_or_planned_marks_each_feature_as_built_or_not_for_the_user_to_correct', () => {
    expect(prompt).toContain('**Built or planned.**')
    expect(prompt).toContain('Mark each proposed feature as behaviour the code already has or behaviour not yet built')
    expect(prompt).toContain('`built: true` or `built: false`')
  })

  it('one_draft_per_pick_writes_plan_feature_spec_md_as_a_draft_held_to_the_spec_contract', () => {
    expect(prompt).toContain('**One draft per pick.**')
    expect(prompt).toContain('write `specs/<slug>.spec.md` with Write')
    expect(prompt).toContain('`status: draft` always')
    expect(prompt).toContain('## Goal')
    expect(prompt).toContain('Derive every rule from the doc sections alone')
  })

  it('source_sections_left_standing_a_draft_does_not_cut_what_it_came_from', () => {
    expect(prompt).toContain('**Source sections left standing.**')
    expect(prompt).toContain('does not cut the sections it came from')
  })

  it('reviewed_as_any_draft_the_job_never_approves_a_migrated_spec_itself', () => {
    expect(prompt).toContain('**Reviewed as any draft.**')
    expect(prompt).toContain('reviewed and approved in the plan view like any other spec')
    expect(prompt).toContain('you never set its status to `approved` yourself')
  })
})

describe('a migrated draft lands its folder the same way as a planning session', () => {
  it('flat_mode_proposes_no_folder_and_writes_straight_to_the_root', () => {
    const prompt = docMigrationPrompt(cwd, 'flat')
    expect(prompt).not.toContain('domain folder')
    expect(prompt).toContain('write `specs/<slug>.spec.md` with Write')
  })

  it('by_domain_mode_proposes_a_folder_per_feature_reusing_what_the_workspace_already_has', () => {
    const prompt = docMigrationPrompt(cwd, 'by-domain', ['orders'])
    expect(prompt).toContain('propose the domain folder its spec would land in')
    expect(prompt).toContain('`orders`')
    expect(prompt).toContain('rather than coining a synonym of it')
    expect(prompt).toContain('write `specs/<folder>/<slug>.spec.md` with Write')
  })

  it('a_draft_and_a_sorted_spec_are_homed_by_the_concepts_the_feature_changes', () => {
    expect(docMigrationPrompt(cwd, 'by-domain')).toContain('the domain that owns the concepts whose information or states the feature changes')
  })

  it('by_domain_mode_writes_a_draft_into_a_folder_at_any_depth', async () => {
    const domainGuard = new ScopeGuard(cwd, docMigrationScope(['docs/api/**'], 'by-domain'))
    const domainUse = (toolName: string, input: unknown) => domainGuard.preToolUse({ toolName, input, toolUseId: 't' })
    expect(await domainUse('Write', { file_path: 'specs/order-cancellation.spec.md' })).toMatchObject({ allow: true })
    expect(await domainUse('Write', { file_path: 'specs/orders/order-cancellation.spec.md' })).toMatchObject({ allow: true })
    expect(await domainUse('Write', { file_path: 'specs/orders/returns/order-cancellation.spec.md' })).toMatchObject({ allow: true })
  })

  it('a_workspace_on_the_default_with_every_spec_at_the_root_may_still_take_folders_from_the_job', () => {
    expect(draftFolders('default', 'flat')).toBe('root-first')
    expect(draftFolders('default', 'by-domain')).toBe('by-domain')
    expect(draftFolders('flat', 'flat')).toBe('flat')
    expect(draftFolders('by-domain', 'by-domain')).toBe('by-domain')
  })

  it('root_first_writes_a_draft_at_the_root_or_into_a_folder_at_any_depth', async () => {
    const rootGuard = new ScopeGuard(cwd, docMigrationScope([], 'root-first'))
    const rootUse = (toolName: string, input: unknown) => rootGuard.preToolUse({ toolName, input, toolUseId: 't' })
    expect(await rootUse('Write', { file_path: 'specs/order-cancellation.spec.md' })).toMatchObject({ allow: true })
    expect(await rootUse('Write', { file_path: 'specs/orders/returns/order-cancellation.spec.md' })).toMatchObject({ allow: true })
    expect(await rootUse('Move', { source: 'specs/order-cancellation.spec.md', destination: 'specs/orders/order-cancellation.spec.md' })).toMatchObject({ allow: true })
  })

  it('a_workspace_set_to_flat_refuses_a_draft_in_a_folder', async () => {
    expect(await use('Write', { file_path: 'specs/orders/order-cancellation.spec.md' })).toMatchObject({ deny: expect.any(String) })
  })

  it('root_first_drafts_at_the_root_until_the_user_asks_for_folders_and_offers_the_sort', () => {
    const prompt = docMigrationPrompt(cwd, 'root-first')
    expect(prompt).toContain('Drafts land at the root of `specs/` unless the user took the offer to sort the specs into folders or asks for folders')
    expect(prompt).toContain('or `specs/<folder>/<slug>.spec.md` where a folder was settled for that feature')
    expect(prompt).toContain('ask once at the start whether to sort the specs that already exist into domain folders')
  })
})

describe('organising the specs that already exist', () => {
  it('nothing_moves_on_its_own_a_workspace_set_to_flat_is_never_offered_the_sort', () => {
    const prompt = docMigrationPrompt(cwd, 'flat')
    expect(prompt).not.toContain('sort the specs that already exist into domain folders')
  })

  it('offered_by_the_docs_cleanup_job_asked_on_its_own_apart_from_the_three_stages', () => {
    const prompt = docMigrationPrompt(cwd, 'by-domain')
    expect(prompt).toContain('Separately from the three stages above, and never as one of them, ask once at the start whether to sort the specs that already exist into domain folders')
    expect(prompt).toContain('taking the offer or declining it leaves the three stages and their order untouched')
    expect(prompt).toContain('you move on to stage one either way')
  })

  it('proposal_before_any_move_names_each_spec_and_the_folder_reusing_what_exists_and_moves_only_what_is_picked', () => {
    const prompt = docMigrationPrompt(cwd, 'by-domain', ['orders'])
    expect(prompt).toContain('**Proposal before any move.**')
    expect(prompt).toContain('name every spec and the domain folder it would go to, reusing a folder the workspace already has (`orders`) rather than coining a synonym of it')
    expect(prompt).toContain('Nothing moves until the person says which proposed moves to make; only those are made.')
  })

  it('already_in_a_folder_is_proposed_for_a_move_only_on_a_mismatch', () => {
    const prompt = docMigrationPrompt(cwd, 'by-domain')
    expect(prompt).toContain('**Already in a folder.**')
    expect(prompt).toContain('proposed for a move only where its folder does not match the domain the others sorted into')
    expect(prompt).toContain('one already in the right folder is left alone')
  })

  it('feature_with_work_in_flight_is_named_as_not_movable_with_what_it_waits_for', () => {
    const prompt = docMigrationPrompt(cwd, 'by-domain', [], [{ feature: 'Order cancellation', path: 'specs/order-cancellation.spec.md', waiting: 'a review in flight' }])
    expect(prompt).toContain('**Feature with work in flight.**')
    expect(prompt).toContain('a review in flight, a decision to rule or an unfinished board is listed as not movable now, saying what it waits for')
    expect(prompt).toContain('"Order cancellation" (specs/order-cancellation.spec.md), waiting on a review in flight')
  })

  it('a_move_keeps_the_feature_moved_with_move_never_write_or_edit', () => {
    const prompt = docMigrationPrompt(cwd, 'by-domain')
    expect(prompt).toContain('**A move keeps the feature.**')
    expect(prompt).toContain('Make a picked move with `Move`, never `Write` or `Edit`')
    expect(prompt).toContain('its name, status, rules and their names, and its review and board are unchanged by the move')
  })

  it('citations_follow_the_move_found_with_spec_search_and_rewritten_in_the_same_change', () => {
    const prompt = docMigrationPrompt(cwd, 'by-domain')
    expect(prompt).toContain('**Citations follow the move.**')
    expect(prompt).toContain('search with SpecSearch for every citation of its path and rewrite each to the new path with Edit, as part of the same change')
  })
})

describe('specs with work in flight are found for the sorting offer', () => {
  let dir: string

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  async function workspace(files: Record<string, string>): Promise<string> {
    dir = await mkdtemp(join(tmpdir(), 'doc-migration-'))
    for (const [path, text] of Object.entries(files)) {
      const file = join(dir, path)
      await mkdir(dirname(file), { recursive: true })
      await writeFile(file, text)
    }
    return dir
  }

  it('a_draft_with_an_open_comment_waits_on_a_review_in_flight', async () => {
    await workspace({
      'specs/order-cancellation.spec.md': '---\nfeature: Order cancellation\nstatus: draft\n---\n# Order cancellation\n\n## Cancelling\n- **Cancel command**: an order can be cancelled\n',
      '.kiwi/specs/order-cancellation.review.md': '# Review\n\n## Round 1, pending\n- on Cancel command: too vague\n',
    })
    expect(await specsWithWorkInFlight(dir)).toEqual([{ feature: 'Order cancellation', path: 'specs/order-cancellation.spec.md', waiting: 'a review in flight' }])
  })

  it('an_approved_spec_with_a_pending_decision_waits_on_a_decision_to_rule', async () => {
    await workspace({
      'specs/order-cancellation.spec.md': '---\nfeature: Order cancellation\nstatus: approved\n---\n# Order cancellation\n\n## Cancelling\n- **Cancel command**: an order can be cancelled\n',
      '.kiwi/specs/order-cancellation.decisions.md': '# Decisions\n\n### Cancel timing\n- on: Cancel command\n- finding: the code waits before cancelling\n',
    })
    expect(await specsWithWorkInFlight(dir)).toEqual([{ feature: 'Order cancellation', path: 'specs/order-cancellation.spec.md', waiting: 'a decision to rule' }])
  })

  it('an_approved_spec_with_an_unfinished_task_waits_on_an_unfinished_board', async () => {
    await workspace({
      'specs/order-cancellation.spec.md': '---\nfeature: Order cancellation\nstatus: approved\n---\n# Order cancellation\n\n## Cancelling\n- **Cancel command**: an order can be cancelled\n',
      '.kiwi/specs/order-cancellation.tasks.json': renderBoard(board(task('Cancel command'))),
    })
    expect(await specsWithWorkInFlight(dir)).toEqual([{ feature: 'Order cancellation', path: 'specs/order-cancellation.spec.md', waiting: 'an unfinished board' }])
  })

  it('a_spec_in_a_folder_with_nothing_in_flight_is_left_out', async () => {
    await workspace({
      'specs/orders/order-cancellation.spec.md': '---\nfeature: Order cancellation\nstatus: approved\n---\n# Order cancellation\n\n## Cancelling\n- **Cancel command**: an order can be cancelled\n',
    })
    expect(await specsWithWorkInFlight(dir)).toEqual([])
  })
})
