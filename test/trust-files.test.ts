import { describe, expect, it } from 'vitest'
import { isRulesFile, isTrustFile } from '../src/agent/permissions/trust-files'
import { MCP_CONFIG_FILE } from '../src/agent/mcp/mcp-config'

describe('trust files', () => {
  it('the_files_that_decide_what_runs_unasked_are_the_root_ones', () => {
    expect(isTrustFile('package.json')).toBe(true)
    expect(isTrustFile('.vscode/settings.json')).toBe(true)
    expect(isTrustFile(MCP_CONFIG_FILE)).toBe(true)
    expect(isTrustFile('team.code-workspace')).toBe(true)
    expect(isTrustFile('frontend/package.json')).toBe(false)
    expect(isTrustFile('frontend/.vscode/settings.json')).toBe(false)
    expect(isTrustFile('nested/team.code-workspace')).toBe(false)
  })

  it('the_claude_engine_s_own_permission_settings_are_trust_files_since_they_are_read_as_kept_answers', () => {
    expect(isTrustFile('.claude/settings.json')).toBe(true)
    expect(isTrustFile('.claude/settings.local.json')).toBe(true)
  })

  it('the_person_s_own_rules_files_are_guarded_the_same_way_outside_every_project', () => {
    const files = ['/home/jonas/.kiwi/permissions.json', '/home/jonas/.claude/settings.json']
    expect(isRulesFile('/home/jonas/.kiwi/permissions.json', files)).toBe(true)
    expect(isRulesFile('/home/jonas/.claude/settings.json', files)).toBe(true)
    expect(isRulesFile('/home/jonas/notes.md', files)).toBe(false)
    expect(isRulesFile('/home/jonas/.kiwi/permissions.json', [])).toBe(false)
  })
})
