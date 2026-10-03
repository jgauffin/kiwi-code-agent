import { describe, expect, it } from 'vitest'
import { isTrustFile } from '../src/agent/permissions/trust-files'
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
})
