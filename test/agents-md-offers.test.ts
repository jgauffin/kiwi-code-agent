import { describe, expect, it } from 'vitest'
import type { BundleScope } from '../src/agent/instructions/bundles'
import { TIDY_WORDS } from '../src/agent/instructions/agents-md-tidy'
import { mergedAgentsText, type PendingMove } from '../src/agent/instructions/claude-md-move'
import { AgentsMdOffers, type OfferKind } from '../src/chat/agents-md-offers'

type Files = { claude?: string; agents?: string }

/** Each scope's files as they stand, with what was moved and which offers were settled. */
function fixture(files: Partial<Record<BundleScope, Files>>, settledBefore: string[] = []) {
  const moved: PendingMove[] = []
  const settled = new Set(settledBefore)
  let changes = 0
  const offers = new AgentsMdOffers(
    {
      pendingMove: (scope) => {
        const file = files[scope]
        if (!file?.claude) return Promise.resolve(undefined)
        return Promise.resolve({
          scope,
          claudePath: `${scope}/CLAUDE.md`,
          agentsPath: `${scope}/AGENTS.md`,
          claudeText: file.claude,
          agentsText: file.agents,
          mergedText: mergedAgentsText(file.claude, file.agents),
        })
      },
      readAgentsMd: (scope) => Promise.resolve({ path: `${scope}/AGENTS.md`, text: files[scope]?.agents }),
      settled: (scope, kind: OfferKind) => settled.has(`${scope}:${kind}`),
      settle: (scope, kind) => {
        settled.add(`${scope}:${kind}`)
        return Promise.resolve()
      },
      applyMove: (move) => {
        moved.push(move)
        return Promise.resolve()
      },
    },
    () => changes++,
  )
  return { offers, moved, settled, files, changes: () => changes }
}

const long = 'word '.repeat(TIDY_WORDS + 1)

describe('AgentsMdOffers: moving CLAUDE.md', () => {
  it('the_workspace_move_is_offered_before_the_persons_own_and_the_next_follows_once_answered', async () => {
    const { offers } = fixture({ project: { claude: 'workspace rules' }, user: { claude: 'own rules' } })
    await offers.load(['project', 'user'])
    expect(offers.current()?.scope).toBe('project')
    await offers.answer('project', 'later')
    expect(offers.current()?.scope).toBe('user')
    await offers.answer('user', 'later')
    expect(offers.current()).toBeUndefined()
  })

  it('a_move_declined_before_is_not_offered_again', async () => {
    const { offers } = fixture({ project: { claude: 'rules' } }, ['project:move'])
    await offers.load(['project'])
    expect(offers.current()).toBeUndefined()
  })

  it('a_decline_is_remembered_while_putting_it_off_is_not', async () => {
    const { offers, settled } = fixture({ project: { claude: 'workspace rules' }, user: { claude: 'own rules' } })
    await offers.load(['project', 'user'])
    await offers.answer('project', 'later')
    await offers.answer('user', 'decline')
    expect([...settled]).toEqual(['user:move'])
  })

  it('a_confirmed_move_writes_what_the_person_was_shown', async () => {
    const { offers, moved } = fixture({ project: { claude: 'rules', agents: 'existing' } })
    await offers.load(['project'])
    const shown = offers.current()!.text
    await offers.answer('project', 'move')
    expect(moved.map((m) => m.mergedText)).toEqual([shown])
    expect(offers.current()).toBeUndefined()
  })

  it('agents_md_written_while_the_offer_stood_open_shows_the_new_text_instead_of_overwriting_it', async () => {
    const { offers, moved, files, changes } = fixture({ project: { claude: 'rules' } })
    await offers.load(['project'])
    files.project = { claude: 'rules', agents: 'a bundle applied meanwhile' }
    const before = changes()
    await offers.answer('project', 'move')
    expect(moved).toEqual([])
    expect(offers.current()?.text).toBe(mergedAgentsText('rules', 'a bundle applied meanwhile'))
    expect(changes()).toBe(before + 1)
  })

  it('a_second_move_click_while_the_first_is_under_way_does_not_apply_it_twice', async () => {
    const { offers, moved } = fixture({ project: { claude: 'rules' } })
    await offers.load(['project'])
    await Promise.all([offers.answer('project', 'move'), offers.answer('project', 'move')])
    expect(moved).toHaveLength(1)
  })

  it('a_claude_md_removed_while_the_offer_stood_open_is_not_moved', async () => {
    const { offers, moved, files } = fixture({ project: { claude: 'rules' } })
    await offers.load(['project'])
    delete files.project
    await offers.answer('project', 'move')
    expect(moved).toEqual([])
    expect(offers.current()).toBeUndefined()
  })
})

describe('AgentsMdOffers: tidying a long AGENTS.md', () => {
  it('a_short_file_is_offered_the_move_but_no_tidy_up', async () => {
    const { offers } = fixture({ project: { claude: 'rules' } })
    await offers.load(['project'])
    expect(offers.current()?.tidyWords).toBeUndefined()
  })

  it('a_long_claude_md_is_offered_the_move_and_a_tidy_up_together', async () => {
    const { offers } = fixture({ user: { claude: long } })
    await offers.load(['user'])
    expect(offers.current()).toMatchObject({ claudePath: 'user/CLAUDE.md', tidyWords: TIDY_WORDS + 1 })
  })

  it('a_long_agents_md_with_nothing_to_move_is_offered_a_tidy_up_alone', async () => {
    const { offers } = fixture({ user: { agents: long } })
    await offers.load(['user'])
    expect(offers.current()?.claudePath).toBeUndefined()
    expect(offers.current()?.tidyWords).toBe(TIDY_WORDS + 1)
  })

  it('tidying_moves_first_and_then_asks_for_the_tidy_chat_on_the_file_it_moved_into', async () => {
    const { offers, moved, settled } = fixture({ user: { claude: long } })
    await offers.load(['user'])
    const request = await offers.answer('user', 'tidy')
    expect(moved).toHaveLength(1)
    expect(request).toEqual({ scope: 'user', agentsPath: 'user/AGENTS.md', bundles: [] })
    expect([...settled]).toEqual(['user:tidy'])
  })

  it('moving_without_the_tidy_up_settles_the_tidy_up_so_it_is_not_raised_again', async () => {
    const { offers, settled, files } = fixture({ user: { claude: long } })
    await offers.load(['user'])
    expect(await offers.answer('user', 'move')).toBeUndefined()
    expect([...settled]).toEqual(['user:tidy'])
    files.user = { agents: long }
    await offers.load(['user'])
    expect(offers.current()).toBeUndefined()
  })

  it('declining_a_combined_offer_settles_both', async () => {
    const { offers, settled, moved } = fixture({ user: { claude: long } })
    await offers.load(['user'])
    await offers.answer('user', 'decline')
    expect(moved).toEqual([])
    expect([...settled].sort()).toEqual(['user:move', 'user:tidy'])
  })

  it('the_tidy_chat_is_told_which_shared_rule_sets_the_file_holds', async () => {
    const bundle = `<!-- bundle source="org/rules" name="ts" version="1" -->\nuse strict\n<!-- /bundle -->`
    const { offers } = fixture({ user: { agents: `${long}\n\n${bundle}\n` } })
    await offers.load(['user'])
    expect((await offers.answer('user', 'tidy'))?.bundles).toEqual(['ts'])
  })

  it('bundle_blocks_do_not_count_toward_the_length_since_their_sources_maintain_them', async () => {
    const bundle = `<!-- bundle source="org/rules" name="ts" version="1" -->\n${long}\n<!-- /bundle -->`
    const { offers } = fixture({ user: { agents: `# Own\n\nshort rules\n\n${bundle}\n` } })
    await offers.load(['user'])
    expect(offers.current()).toBeUndefined()
  })
})
