import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// The extension must install on VS Code 1.100 and forks built on it. Raising the floor
// silently drops those users, so the API surface is frozen there.
const manifest = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'))

describe('VS Code engine pin', () => {
  it('extension_installs_on_vscode_1_100', () => {
    expect(manifest.engines.vscode).toBe('^1.100.0')
  })

  it('typings_expose_no_api_newer_than_1_100', () => {
    expect(manifest.devDependencies['@types/vscode']).toBe('~1.100.0')
  })
})
