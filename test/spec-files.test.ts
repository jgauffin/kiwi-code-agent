import { describe, expect, it } from 'vitest'
import { draftFeatureOf, isSpecPath, specBadge, specFeatureOf } from '../src/chat/spec-files'

describe('spec badges in the explorer', () => {
  const statuses = ['draft', 'approved', 'implemented', 'verified'] as const

  it('every_status_shows_as_one_character_so_the_explorer_can_carry_it', () => {
    for (const status of statuses) expect(specBadge(status).badge).toHaveLength(1)
  })

  it('no_status_shows_as_a_letter_so_the_badge_is_not_read_as_gits', () => {
    for (const status of statuses) expect(specBadge(status).badge).not.toMatch(/[a-z]/i)
  })

  it('each_status_has_a_badge_and_tooltip_of_its_own', () => {
    const badges = statuses.map((s) => specBadge(s))
    expect(new Set(badges.map((b) => b.badge)).size).toBe(4)
    expect(new Set(badges.map((b) => b.tooltip)).size).toBe(4)
  })

  it('only_the_workspaces_own_spec_files_are_badged', () => {
    expect(isSpecPath('D:/work/app', 'D:/work/app/specs/orders.spec.md')).toBe(true)
    expect(isSpecPath('D:/work/app', 'D:/work/app/specs/notes.md')).toBe(false)
    expect(isSpecPath('D:/work/app', 'D:/work/app/docs/orders.spec.md')).toBe(false)
    expect(isSpecPath('D:/work/app', 'D:/other/specs/orders.spec.md')).toBe(false)
  })

  it('a_spec_filed_in_a_folder_is_badged_like_any_other_however_deep', () => {
    expect(isSpecPath('D:/work/app', 'D:/work/app/specs/old/orders.spec.md')).toBe(true)
    expect(isSpecPath('D:/work/app', 'D:/work/app/specs/old/archive/orders.spec.md')).toBe(true)
    expect(isSpecPath('D:/work/app', 'D:/work/app/specs/old/notes.md')).toBe(false)
  })
})

describe('planning the spec being read', () => {
  const path = 'D:/work/app/specs/order-history.spec.md'

  it('a_draft_offers_the_feature_its_front_matter_names', () => {
    expect(draftFeatureOf('D:/work/app', path, '---\nfeature: Order history\nstatus: draft\n---\n')).toBe('Order history')
  })

  it('a_draft_without_a_feature_line_falls_back_to_its_file_name', () => {
    expect(draftFeatureOf('D:/work/app', path, '# Order history\n')).toBe('order-history')
  })

  it('a_settled_spec_offers_nothing_so_the_planner_is_not_on_offer_for_it', () => {
    expect(draftFeatureOf('D:/work/app', path, '---\nfeature: Order history\nstatus: approved\n---\n')).toBeUndefined()
    expect(draftFeatureOf('D:/work/app', path, '---\nstatus: verified\n---\n')).toBeUndefined()
  })

  it('a_draft_outside_the_spec_folder_offers_nothing', () => {
    expect(draftFeatureOf('D:/work/app', 'D:/work/app/docs/order-history.spec.md', '---\nstatus: draft\n---\n')).toBeUndefined()
  })

  it('a_settled_spec_still_names_its_feature_for_the_right_click_menu', () => {
    expect(specFeatureOf('D:/work/app', path, '---\nfeature: Order history\nstatus: verified\n---\n')).toEqual({
      feature: 'Order history',
      status: 'verified',
    })
    expect(specFeatureOf('D:/work/app', 'D:/work/app/readme.md', '# Readme\n')).toBeUndefined()
  })
})
