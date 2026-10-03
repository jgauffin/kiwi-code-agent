import { describe, expect, it } from 'vitest'
import { draftPickupPrompt } from '../src/agent/phases/blind-plan'
import { FUTURE_FILE, UNFILED_FILE } from '../src/agent/phases/unfiled-decisions'

/** The prompt with its hard wrapping flattened, so an assertion does not depend on where a sentence breaks. */
const flowed = (prompt: string): string => prompt.replace(/\s+/g, ' ')

describe('carrying a draft on', () => {
  it('critique_before_any_write_says_what_the_draft_settles_and_waits_for_go', () => {
    const prompt = flowed(draftPickupPrompt('Order cancellation', 'hand-written', { review: false, decisions: false }))
    expect(prompt).toContain('critique the draft in chat before writing anything')
    expect(prompt).toContain('what it settles, which of its rules you would amend, drop or add, and which questions it leaves open')
    expect(prompt).toContain('A short message, then stop and wait. Write nothing until the user says go.')
  })

  it('depth_of_critique_follows_how_the_draft_was_authored', () => {
    const planned = flowed(draftPickupPrompt('Order cancellation', 'planned', { review: false, decisions: false }))
    expect(planned).toContain('take it as complete and critique only what changed around it since')

    const drafted = flowed(draftPickupPrompt('Order cancellation', 'drafted', { review: false, decisions: false }))
    expect(drafted).toContain('critique it for the gaps its source sections left and for overlap')

    const handWritten = flowed(draftPickupPrompt('Order cancellation', 'hand-written', { review: false, decisions: false }))
    expect(handWritten).toContain('critique it whole, missing scenarios, rules no test could prove, and whether the direction holds')
  })

  it('review_in_flight_answers_first_before_any_critique_of_its_own', () => {
    const withReview = flowed(draftPickupPrompt('Order cancellation', 'hand-written', { review: true, decisions: false }))
    expect(withReview).toContain('If the review has a comment with no resolution yet, or a struck item still standing in the spec: answer that first')
    expect(withReview).toContain('addressed: what you changed')
    expect(withReview).toContain('disagreed: why you will not')
    expect(withReview).toContain('Raise nothing of your own until every comment of that round is answered')

    const withoutReview = flowed(draftPickupPrompt('Order cancellation', 'hand-written', { review: false, decisions: false }))
    expect(withoutReview).not.toContain('answer that first')
  })

  it('recorded_decisions_naming_the_feature_are_named_in_the_critique', () => {
    const prompt = draftPickupPrompt('Order cancellation', 'hand-written', { review: false, decisions: false })
    expect(prompt).toContain(UNFILED_FILE)
    expect(prompt).toContain(FUTURE_FILE)
    expect(flowed(prompt)).toContain('whose affects names "Order cancellation"')
    expect(flowed(prompt)).toContain('Fold its words into the rules only once the user says so')
    expect(flowed(prompt)).toContain('once they stand as rules, delete the entry from its file')
  })

  it('names_are_not_settled_yet_a_draft_rule_may_be_renamed_or_dropped_outright', () => {
    const prompt = flowed(draftPickupPrompt('Order cancellation', 'hand-written', { review: false, decisions: false }))
    expect(prompt).toContain('rename it, drop it, or add one outright, since nothing has been approved, tasked or proved from it yet')
  })

  it('renaming_a_commented_rule_keeps_the_was_note_so_the_comment_still_finds_it', () => {
    const prompt = flowed(draftPickupPrompt('Order cancellation', 'hand-written', { review: false, decisions: false }))
    expect(prompt).toContain('a rule the review has already commented on: keep its `(was Old name)` note when you rename it, so the comment still finds it')
  })

  it('overlapping_drafts_are_named_with_an_ownership_proposal', () => {
    const prompt = flowed(draftPickupPrompt('Order cancellation', 'hand-written', { review: false, decisions: false }))
    expect(prompt).toContain('Search SpecSearch for every other draft whose rules describe behaviour this one also claims')
    expect(prompt).toContain('Name each overlapping draft in the critique and propose which of the two features should own the behaviour')
  })

  it('planned_drafts_limit_the_overlap_search_to_what_changed_since_they_were_last_touched', () => {
    const planned = flowed(draftPickupPrompt('Order cancellation', 'planned', { review: false, decisions: false }))
    expect(planned).toContain('limit any search for an overlapping draft to the specs and drafts written or changed since you last touched this one')

    const handWritten = flowed(draftPickupPrompt('Order cancellation', 'hand-written', { review: false, decisions: false }))
    expect(handWritten).not.toContain('limit any search for an overlapping draft')
  })

  it('only_its_own_spec_is_written_whatever_the_overlap', () => {
    const prompt = flowed(draftPickupPrompt('Order cancellation', 'hand-written', { review: false, decisions: false }))
    expect(prompt).toContain("Write only `specs/order-cancellation.spec.md`, never the other draft's, whatever the overlap")
  })

  it('ownership_ruling_is_recorded_as_an_unfiled_decision_naming_both_features', () => {
    const prompt = flowed(draftPickupPrompt('Order cancellation', 'hand-written', { review: false, decisions: false }))
    expect(prompt).toContain(
      "once the user rules which feature owns it, record the ruling as an unfiled decision in `specs/unfiled-decisions.md` naming both features, so the other draft's own pickup takes it in",
    )
  })

  it('an_approved_spec_defining_the_behaviour_is_no_overlap', () => {
    const prompt = flowed(draftPickupPrompt('Order cancellation', 'hand-written', { review: false, decisions: false }))
    expect(prompt).toContain(
      "behaviour an approved spec already defines is no question of ownership, so let this draft's own rule stand or cite that spec instead, never name it as an overlap",
    )
  })

  it('another_direction_is_proposed_in_chat_leaving_the_draft_untouched_until_the_user_chooses', () => {
    const prompt = flowed(draftPickupPrompt('Order cancellation', 'hand-written', { review: false, decisions: false }))
    expect(prompt).toContain("Where you judge the draft's whole shape wrong, not just its rules, say so instead: the direction you would take and why, and leave the spec untouched until the user chooses.")
  })

  it('draft_direction_kept_is_carried_on_without_raising_the_same_redirect_again', () => {
    const prompt = flowed(draftPickupPrompt('Order cancellation', 'hand-written', { review: false, decisions: false }))
    expect(prompt).toContain("If they keep the draft's direction, carry it on as it stands and do not raise this same redirect again in this session.")
  })

  it('a_direction_taken_is_rewritten_in_the_same_spec_file_never_a_second_one', () => {
    const prompt = flowed(draftPickupPrompt('Order cancellation', 'hand-written', { review: false, decisions: false }))
    expect(prompt).toContain('If they take yours, rewrite `specs/order-cancellation.spec.md` itself to the contract: never a second spec for the same feature.')
  })
})
