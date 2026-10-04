import { describe, expect, it } from 'vitest'
import { updatePrompt } from '../src/agent/phases/blind-plan'
import { UNFILED_FILE, FUTURE_FILE } from '../src/agent/phases/unfiled-decisions'

/** The prompt with its hard wrapping flattened, so an assertion does not depend on where a sentence breaks. */
const flowed = (prompt: string): string => prompt.replace(/\s+/g, ' ')

describe('what the update session does with the description', () => {
  it('is_the_ordinary_change_to_that_one_spec_blind_and_revised_in_place_then_reviewed_like_any_draft', () => {
    const prompt = updatePrompt('Order cancellation')
    expect(flowed(prompt)).toContain('revise `specs/order-cancellation.spec.md` itself, to the same contract')
    expect(flowed(prompt)).toContain('never a second spec and never a separate file of changes')
    expect(flowed(prompt)).toContain('Set the front matter `status` back to `draft`')
    expect(flowed(prompt)).toContain('the revision is reviewed like any draft')
    expect(flowed(prompt)).toContain('you answer them, before Approve')
  })

  it('is_analysed_in_chat_before_anything_is_written', () => {
    const prompt = updatePrompt('Order cancellation')
    expect(flowed(prompt)).toContain("which of the spec's existing rules the change would amend, which it would drop, and what it would add")
    expect(flowed(prompt)).toContain('Write nothing until they say go')
  })

  it('leaves_a_rule_the_description_does_not_reach_as_it_stands_naming_other_behaviour_rather_than_taking_it_in', () => {
    const prompt = updatePrompt('Order cancellation')
    expect(flowed(prompt)).toContain('A rule it does not reach stays exactly as it stands')
    expect(flowed(prompt)).toContain('where you judge other behaviour must change alongside it, only name that in the direction, and take it in if they say so')
  })

  it('answers_every_part_of_the_description_taken_in_named_or_declined_with_a_reason', () => {
    const prompt = updatePrompt('Order cancellation')
    expect(flowed(prompt)).toContain(
      'Answer every part of what they wrote: each thing it asks for is taken in, named as something the direction would amend, drop or add, or declined with a reason, so nothing they typed is left without an answer',
    )
  })

  it('names_which_feature_owns_behaviour_another_settled_spec_already_defines_and_records_the_ownership_as_an_unfiled_decision', () => {
    const prompt = updatePrompt('Order cancellation')
    expect(flowed(prompt)).toContain('Search SpecSearch for a settled spec that already defines what they described')
    expect(flowed(prompt)).toContain('name in the direction which feature owns it and write only `specs/order-cancellation.spec.md`, never the other spec')
    expect(prompt).toContain(UNFILED_FILE)
    expect(flowed(prompt)).toContain(`record the ownership as an unfiled decision in \`${UNFILED_FILE}\` naming both features`)
  })

  it('still_folds_in_an_unfiled_decision_naming_the_feature_and_offers_a_future_work_entry_naming_it', () => {
    const prompt = updatePrompt('Order cancellation')
    expect(prompt).toContain(FUTURE_FILE)
    expect(flowed(prompt)).toContain('Fold in an unfiled entry that names this feature')
    expect(flowed(prompt)).toContain('name a future-work entry that names it as something the change could take in, and take it in only if the developer says so')
  })
})
