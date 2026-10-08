import { describe, expect, it } from 'vitest'
import { findInstalledClaude, type ClaudeLookup } from '../src/agent/sdk-session/installed-claude'

const windows = (present: string[], over: Partial<ClaudeLookup> = {}): ClaudeLookup => ({
  path: 'C:\\tools;C:\\Users\\me\\bin',
  home: 'C:\\Users\\me',
  windows: true,
  exists: (candidate) => present.includes(candidate),
  ...over,
})

const posix = (present: string[], over: Partial<ClaudeLookup> = {}): ClaudeLookup => ({
  path: '/usr/bin:/usr/local/bin',
  home: '/home/me',
  windows: false,
  exists: (candidate) => present.includes(candidate),
  ...over,
})

describe('finding the Claude Code installed on the machine', () => {
  it('a_machine_with_no_claude_code_offers_none', () => {
    expect(findInstalledClaude(windows([]))).toBeUndefined()
  })

  it('a_binary_on_the_path_is_found_at_the_first_directory_that_holds_it', () => {
    expect(findInstalledClaude(windows(['C:\\Users\\me\\bin\\claude.exe']))).toBe('C:\\Users\\me\\bin\\claude.exe')
  })

  it('the_earlier_path_directory_wins_as_the_shell_would_resolve_it', () => {
    expect(findInstalledClaude(windows(['C:\\tools\\claude.exe', 'C:\\Users\\me\\bin\\claude.exe']))).toBe('C:\\tools\\claude.exe')
  })

  it('what_the_native_installer_wrote_is_found_though_the_path_does_not_name_it', () => {
    expect(findInstalledClaude(posix(['/home/me/.local/bin/claude']))).toBe('/home/me/.local/bin/claude')
  })

  it('a_configured_path_wins_over_every_install_on_the_machine', () => {
    const lookup = posix(['/opt/claude-2.1.290/claude', '/usr/bin/claude'], { configured: '/opt/claude-2.1.290/claude' })
    expect(findInstalledClaude(lookup)).toBe('/opt/claude-2.1.290/claude')
  })

  it('a_configured_path_that_names_nothing_leaves_the_engine_missing_rather_than_falling_back', () => {
    expect(findInstalledClaude(posix(['/usr/bin/claude'], { configured: '/opt/typo/claude' }))).toBeUndefined()
  })

  it('a_blank_setting_counts_as_none_set', () => {
    expect(findInstalledClaude(posix(['/usr/bin/claude'], { configured: '   ' }))).toBe('/usr/bin/claude')
  })

  it('a_windows_cmd_shim_is_not_taken_since_the_engine_is_started_without_a_shell', () => {
    expect(findInstalledClaude(windows(['C:\\tools\\claude.cmd']))).toBeUndefined()
  })

  it('an_empty_path_entry_is_not_searched_as_the_working_directory', () => {
    expect(findInstalledClaude(posix(['claude'], { path: '::' }))).toBeUndefined()
  })
})
