import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readSpecState, setSpecStatus, statusOf, withStatus } from '../src/agent/phases/spec-file'

const spec = '---\nfeature: Orders\nstatus: draft\n---\n\n# Orders\n\n- B1: rule\n'

describe('spec front-matter status', () => {
  it('draft_is_the_default_when_status_is_missing_or_anything_but_approved', () => {
    expect(statusOf(spec)).toBe('draft')
    expect(statusOf('# no front matter')).toBe('draft')
    expect(statusOf('---\nstatus: whatever\n---\n')).toBe('draft')
    expect(statusOf('---\nstatus: approved\n---\n')).toBe('approved')
  })

  it('approving_rewrites_only_the_status_line_and_keeps_the_body', () => {
    const approved = withStatus(spec, 'approved')
    expect(approved).toBe('---\nfeature: Orders\nstatus: approved\n---\n\n# Orders\n\n- B1: rule\n')
    expect(withStatus(approved, 'draft')).toBe(spec)
  })

  it('a_spec_without_front_matter_gets_one', () => {
    expect(withStatus('# Orders\n', 'approved')).toBe('---\nstatus: approved\n---\n\n# Orders\n')
  })

  it('reads_and_writes_the_file_and_reports_a_missing_spec', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'spec-'))
    try {
      const path = join(dir, 'orders.spec.md')
      expect(await readSpecState(path)).toEqual({ exists: false })
      await writeFile(path, spec)
      expect(await readSpecState(path)).toEqual({ exists: true, status: 'draft' })
      await setSpecStatus(path, 'approved')
      expect(await readSpecState(path)).toEqual({ exists: true, status: 'approved' })
      expect(await readFile(path, 'utf8')).toContain('# Orders')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
