import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { projectMemoryDir, rebuildProjectIndex, userMemoryFile } from '../src/agent/memory/memories'
import { chatMemorySection, memorySection, readMemorySources, withMemories } from '../src/agent/memory/session-context'
import { buildSystemPrompt } from '../src/agent/openai-session/system-prompt'

let cwd: string
let home: string

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'memctx-cwd-'))
  home = await mkdtemp(join(tmpdir(), 'memctx-home-'))
})

afterEach(async () => {
  await rm(cwd, { recursive: true, force: true })
  await rm(home, { recursive: true, force: true })
})

/** A project note and a user note on disk, the shape every test here starts from. */
async function withNotes(): Promise<void> {
  const dir = projectMemoryDir(cwd, home)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'proxy-quirk.md'), '# Proxy quirk\nNTLM proxies 407 on telemetry.\nThe vendor ticket number and the full remediation steps live only in this file, not the index.\n')
  await rebuildProjectIndex(dir)
  await mkdir(join(home, '.claude'), { recursive: true })
  await writeFile(userMemoryFile(home), '# Me\n\n## Memories\n- **Terse replies**: keep answers short.\n')
}

describe('index first and note on demand', () => {
  it('a project note is named by its index line, its body left for a later Read', async () => {
    await withNotes()
    const prompt = await withMemories('implement', 'BASE', cwd, home)
    expect(prompt).toContain('[Proxy quirk](proxy-quirk.md)')
    expect(prompt).toContain('NTLM proxies 407 on telemetry.')
    expect(prompt).not.toContain('vendor ticket number')
  })

  it("a person's own note has no separate body: the bullet is already the whole of it", async () => {
    await withNotes()
    const prompt = await withMemories('implement', 'BASE', cwd, home)
    expect(prompt).toContain('**Terse replies**: keep answers short.')
  })
})

describe('memory written mid-session', () => {
  it('a note settled after the session starts is not retrofitted into the index it started with', async () => {
    await withNotes()
    const started = await withMemories('implement', 'BASE', cwd, home)
    expect(started).not.toContain('New thing')
    // The person settles something new mid-session; a session already running keeps the index it opened with.
    await writeFile(join(projectMemoryDir(cwd, home), 'new-thing.md'), '# New thing\nSettled mid-session.\n')
    await rebuildProjectIndex(projectMemoryDir(cwd, home))
    expect(started).not.toContain('New thing')
    // A session starting fresh afterwards sees it.
    expect(await withMemories('implement', 'BASE', cwd, home)).toContain('New thing')
  })
})

describe('project over user on a clash', () => {
  it('both scopes present says the project note holds', async () => {
    await withNotes()
    expect(await withMemories('implement', 'BASE', cwd, home)).toContain(
      'Where a project note and one of your own say different things about the same subject, the project note holds.',
    )
  })

  it('nothing to clash against when only one scope has notes', async () => {
    const dir = projectMemoryDir(cwd, home)
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'solo.md'), '# Solo\nJust the one.\n')
    await rebuildProjectIndex(dir)
    expect(await withMemories('implement', 'BASE', cwd, home)).not.toContain('the project note holds')
  })
})

describe('same memories on both engines', () => {
  it('the own loop and the Claude engine read the same project and user notes', async () => {
    await withNotes()
    const openAi = await buildSystemPrompt(cwd, undefined, home)
    const claude = await chatMemorySection(cwd, home)
    for (const marker of ['[Proxy quirk](proxy-quirk.md)', '**Terse replies**: keep answers short.']) {
      expect(openAi).toContain(marker)
      expect(claude).toContain(marker)
    }
  })
})

describe('no second copy on the Claude engine', () => {
  it('the project note is said once in the Claude chat prompt, not duplicated alongside the index', async () => {
    await withNotes()
    const section = (await chatMemorySection(cwd, home))!
    expect(section.split('Proxy quirk').length - 1).toBe(1)
    expect(section.split('Terse replies').length - 1).toBe(1)
  })

  it("the own loop's chat prompt carries the person's notes once, through its instruction files, not again through the index", async () => {
    await withNotes()
    const prompt = await buildSystemPrompt(cwd, undefined, home)
    expect(prompt.split('Terse replies').length - 1).toBe(1)
  })
})

describe('the blind planner gets none', () => {
  it('a plan session is handed its prompt back untouched', async () => {
    await withNotes()
    expect(await withMemories('plan', 'BASE', cwd, home)).toBe('BASE')
  })

  it('nothing on disk reads to nothing added, for any other mode', async () => {
    expect(await withMemories('implement', 'BASE', cwd, home)).toBe('BASE')
  })
})

describe('readMemorySources and memorySection', () => {
  it('a missing project index and a missing user file add nothing', async () => {
    expect(await readMemorySources(cwd, home)).toEqual({ project: undefined, user: undefined })
    expect(memorySection({ project: undefined, user: undefined })).toBeUndefined()
  })
})
