import { describe, expect, it } from 'vitest'
import { blindPlanScope, changePrompt } from '../src/agent/phases/blind-plan'
import { UNFILED_FILE, FUTURE_FILE } from '../src/agent/phases/unfiled-decisions'
import { assertCommentable, isCommentable } from '../src/agent/phases/plan-review'
import type { SpecState } from '../src/agent/phases/spec-file'

/** The prompt with its hard wrapping flattened, so an assertion does not depend on where a sentence breaks. */
const flowed = (prompt: string): string => prompt.replace(/\s+/g, ' ')

describe('starting a change', () => {
  it('starts_from_the_feature_own_spec_rather_than_an_earlier_conversation_about_it', () => {
    const prompt = changePrompt('Order cancellation')
    expect(prompt).toContain('specs/order-cancellation.spec.md')
    expect(flowed(prompt)).toContain('This is a change to it, not a new feature')
    expect(flowed(prompt)).toContain('never from an earlier conversation about it')
  })

  it('names_which_rules_the_change_would_amend_drop_or_add_before_writing_anything', () => {
    const prompt = changePrompt('Order cancellation')
    expect(flowed(prompt)).toContain("which of the spec's existing rules the change would amend, which it would drop, and what it would add")
    expect(flowed(prompt)).toContain('Write nothing until they say go')
  })

  it('folds_in_an_unfiled_decision_naming_the_feature_and_offers_a_future_work_entry_naming_it', () => {
    const prompt = changePrompt('Order cancellation')
    expect(prompt).toContain(UNFILED_FILE)
    expect(prompt).toContain(FUTURE_FILE)
    expect(flowed(prompt)).toContain('Fold in an unfiled entry that names this feature')
    expect(flowed(prompt)).toContain('name a future-work entry that names it as something the change could take in, and take it in only if the developer says so')
  })

  it('a_change_session_is_blind_like_any_other_plan_session_scoped_to_the_same_files', () => {
    // Change reuses the ordinary blind-planning scope and tool set: no new way to reach the code.
    const scope = blindPlanScope('Order cancellation')
    expect(scope.readable).toEqual(expect.arrayContaining(['docs/**', expect.stringContaining('README'), 'specs/*.spec.md', UNFILED_FILE, FUTURE_FILE, 'specs/order-cancellation.spec.md']))
    expect(scope.writable).toEqual(expect.arrayContaining(['specs/order-cancellation.spec.md', UNFILED_FILE, FUTURE_FILE]))
  })
})

describe('revising the settled rules', () => {
  it('rewrites_the_feature_own_spec_file_rather_than_a_second_spec_or_a_file_of_changes', () => {
    const prompt = changePrompt('Order cancellation')
    expect(flowed(prompt)).toContain('revise `specs/order-cancellation.spec.md` itself, to the same contract')
    expect(flowed(prompt)).toContain('never a second spec and never a separate file of changes')
  })

  it('puts_new_behaviour_in_its_scenario_or_gives_it_a_new_one', () => {
    const prompt = changePrompt('Order cancellation')
    expect(flowed(prompt)).toContain('Behaviour that belongs to a situation the spec already has becomes rules in that scenario')
    expect(flowed(prompt)).toContain('behaviour that is a situation of its own becomes a new `##` scenario')
  })

  it('sets_the_spec_status_back_to_draft_on_revision', () => {
    const prompt = changePrompt('Order cancellation')
    expect(flowed(prompt)).toContain('Set the front matter `status` back to `draft`')
    expect(flowed(prompt)).toContain('the feature stands as a plan being made again until the user approves it')
  })

  it('sends_the_revision_through_the_ordinary_review_before_approve', () => {
    const prompt = changePrompt('Order cancellation')
    expect(prompt).toContain('.kiwi/specs/order-cancellation.review.md')
    expect(flowed(prompt)).toContain('the revision is reviewed like any draft')
    expect(flowed(prompt)).toContain('you answer them, before Approve')
  })

  it('a_spec_put_back_to_draft_by_a_revision_is_commentable_like_any_other_draft', () => {
    // The revision only ever changes the status; the ordinary review mechanics (comment, strike, resolve) are unchanged.
    const revised: SpecState = { exists: true, status: 'draft', body: '## Goal\ntext\n\n## Cancelling an order\n- **Cancel command**: text\n', built: false }
    expect(isCommentable(revised)).toBe(true)
    expect(() => assertCommentable(revised)).not.toThrow()
  })
})
