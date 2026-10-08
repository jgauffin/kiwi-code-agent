import { describe, expect, it } from 'vitest'
import { isPersonRulesFile, isTrustFile } from '../src/agent/permissions/trust-files'
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

  it('the_persons_own_rules_file_is_guarded_the_same_way_outside_every_project', () => {
    expect(isPersonRulesFile('/home/jonas/.kiwi/permissions.json', '/home/jonas/.kiwi/permissions.json')).toBe(true)
    expect(isPersonRulesFile('/home/jonas/notes.md', '/home/jonas/.kiwi/permissions.json')).toBe(false)
    expect(isPersonRulesFile('/home/jonas/.kiwi/permissions.json', undefined)).toBe(false)
  })
})
