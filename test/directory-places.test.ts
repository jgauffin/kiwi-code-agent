import { describe, expect, it } from 'vitest'
import { placesToKeep, wildcardFree } from '../src/agent/permissions/directory-places'

const root = process.platform === 'win32' ? 'E:' : ''

describe('the places a directory answer may be kept for', () => {
  it('climb_from_the_directory_to_just_below_the_drive_root', () => {
    expect(placesToKeep(`${root}/a/b/c`, undefined)).toEqual([`${root}/a/b/c`, `${root}/a/b`, `${root}/a`])
  })

  it('stop_below_the_home_folder_and_offer_nothing_holding_it', () => {
    const home = `${root}/users/me`
    expect(placesToKeep(`${home}/.cargo/registry`, home)).toEqual([`${home}/.cargo/registry`, `${home}/.cargo`])
    expect(placesToKeep(home, home)).toEqual([])
    expect(placesToKeep(`${root}/users`, home)).toEqual([])
  })

  it('a_wildcard_leaves_only_the_directories_above_it', () => {
    expect(wildcardFree('/a/b/*/c')).toBe('/a/b/')
    expect(wildcardFree('/a/b?/c')).toBe('/a/')
    expect(wildcardFree('/a/b')).toBe('/a/b')
    expect(wildcardFree('*/c')).toBeUndefined()
  })
})
