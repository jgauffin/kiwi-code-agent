import { describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { existingSpecFolders, resolveSpecFoldersMode } from '../src/agent/phases/spec-folders'

async function workspace(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'spec-folders-'))
  await mkdir(join(dir, 'specs'))
  for (const [name, text] of Object.entries(files)) {
    const parts = name.split('/')
    if (parts.length > 1) await mkdir(join(dir, 'specs', ...parts.slice(0, -1)), { recursive: true })
    await writeFile(join(dir, 'specs', ...parts), text)
  }
  return dir
}

describe('existing spec folders', () => {
  it('a_folder_holding_a_spec_is_reported', async () => {
    const dir = await workspace({ 'orders/refunds.spec.md': '# Refunds\n' })
    try {
      expect(await existingSpecFolders(dir)).toEqual(['orders'])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('a_folder_inside_a_folder_is_reported_by_its_path_beside_its_parent_once_each_holds_a_spec', async () => {
    const dir = await workspace({ 'orders/refunds.spec.md': '# Refunds\n', 'orders/returns/labels.spec.md': '# Labels\n', 'billing/invoices/dunning.spec.md': '# Dunning\n' })
    try {
      expect(await existingSpecFolders(dir)).toEqual(['billing/invoices', 'orders', 'orders/returns'])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('an_empty_folder_left_behind_does_not_count', async () => {
    const dir = await workspace({ 'orders.spec.md': '# Orders\n' })
    await mkdir(join(dir, 'specs', 'empty'))
    try {
      expect(await existingSpecFolders(dir)).toEqual([])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('a_workspace_with_no_specs_directory_has_no_folders', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'spec-folders-'))
    try {
      expect(await existingSpecFolders(dir)).toEqual([])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('resolving kiwiAgent.specFolders', () => {
  it('by_domain_and_flat_always_resolve_to_themselves', async () => {
    const dir = await workspace({})
    try {
      expect(await resolveSpecFoldersMode(dir, 'by-domain')).toBe('by-domain')
      expect(await resolveSpecFoldersMode(dir, 'flat')).toBe('flat')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('default_follows_a_workspace_whose_specs_all_sit_at_the_root', async () => {
    const dir = await workspace({ 'orders.spec.md': '# Orders\n' })
    try {
      expect(await resolveSpecFoldersMode(dir, 'default')).toBe('flat')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('default_follows_a_workspace_that_already_has_a_domain_folder', async () => {
    const dir = await workspace({ 'orders/refunds.spec.md': '# Refunds\n' })
    try {
      expect(await resolveSpecFoldersMode(dir, 'default')).toBe('by-domain')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
