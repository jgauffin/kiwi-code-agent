import { describe, expect, it } from 'vitest'
import { join, resolve } from 'node:path'
import { editDiffTitle, editLine, isRunSnapshot, runsRoot } from '../src/agent/edits/open-edit'

const root = runsRoot(resolve('/work'))

describe('isRunSnapshot', () => {
  it('accepts a snapshot this extension wrote under the run directory', () => {
    expect(isRunSnapshot(root, join(root, 'session-1', 'edits', 'abc-app.ts'))).toBe(true)
  })

  it('refuses a path outside the run directory', () => {
    expect(isRunSnapshot(root, resolve('/work/src/app.ts'))).toBe(false)
    expect(isRunSnapshot(root, join(root, '..', '..', 'etc', 'passwd'))).toBe(false)
  })

  it('refuses a relative path', () => {
    expect(isRunSnapshot(root, 'edits/abc-app.ts')).toBe(false)
  })

  it('refuses the run directory itself', () => {
    expect(isRunSnapshot(root, root)).toBe(false)
  })
})

describe('editLine', () => {
  it('turns the first changed line into a zero-based position', () => {
    expect(editLine(12, 100)).toBe(11)
  })

  it('opens at the top when no line is known', () => {
    expect(editLine(undefined, 100)).toBe(0)
  })

  it('clamps to a file that has since shrunk', () => {
    expect(editLine(80, 10)).toBe(9)
    expect(editLine(3, 0)).toBe(0)
  })
})

describe('editDiffTitle', () => {
  it('names the file and what the two sides are', () => {
    expect(editDiffTitle('src/app.ts')).toContain('src/app.ts')
    expect(editDiffTitle('src/app.ts')).toMatch(/before/i)
  })
})
