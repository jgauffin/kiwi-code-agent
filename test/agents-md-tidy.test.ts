import { describe, expect, it } from 'vitest'
import { agentsMdTidyKickoff } from '../src/agent/instructions/agents-md-tidy'

describe('agentsMdTidyKickoff', () => {
  it('a_file_without_shared_rule_sets_gets_no_instruction_about_them', () => {
    expect(agentsMdTidyKickoff('user', '/home/me/AGENTS.md', [])).not.toContain('bundle')
  })

  it('shared_rule_sets_are_named_with_their_markers_and_why_editing_them_is_lost', () => {
    const kickoff = agentsMdTidyKickoff('project', '/repo/AGENTS.md', ['typescript', 'testing'])
    expect(kickoff).toContain('typescript, testing')
    expect(kickoff).toContain('<!-- /bundle -->')
    expect(kickoff).toContain('an edit there would be lost')
  })
})
