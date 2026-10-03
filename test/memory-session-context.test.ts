import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { projectMemoryDir, rebuildProjectIndex, userMemoryFile } from '../src/agent/memory/memories'
import { chatMemorySection, memorySection, readMemorySources, wantsMemories, withMemories } from '../src/agent/memory/session-context'
import { readInstructionFiles, instructionsText } from '../src/agent/instructions/instruction-files'
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

  it("a person's own note has no separate body: the bullet is already the whole of it, carried through the instruction files", async () => {
    await withNotes()
    // The person's notes live inside their own instruction file; `withMemories` carries only the project's.
    expect(await withMemories('implement', 'BASE', cwd, home)).not.toContain('Terse replies')
    expect(instructionsText(await readInstructionFiles(cwd, home))).toContain('**Terse replies**: keep answers short.')
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

describe('same project notes on both engines', () => {
  it('the own loop and the Claude engine read the same project index', async () => {
    await withNotes()
    const openAi = await buildSystemPrompt(cwd, undefined, home)
    const claude = await chatMemorySection(cwd, home)
    expect(openAi).toContain('[Proxy quirk](proxy-quirk.md)')
    expect(claude).toContain('[Proxy quirk](proxy-quirk.md)')
  })

  it("the person's own note rides the instruction files on both engines instead, not the project index", async () => {
    await withNotes()
    expect(await chatMemorySection(cwd, home)).not.toContain('Terse replies')
    const section = instructionsText(await readInstructionFiles(cwd, home))
    expect(section).toContain('Terse replies')
  })
})

describe('no second copy on the Claude engine', () => {
  it('the project note is said once in the Claude chat prompt, not duplicated alongside the index', async () => {
    await withNotes()
    const section = (await chatMemorySection(cwd, home))!
    expect(section.split('Proxy quirk').length - 1).toBe(1)
  })

  it("the own loop's chat prompt carries the person's notes once, through its instruction files, not again through the index", async () => {
    await withNotes()
    const prompt = await buildSystemPrompt(cwd, undefined, home)
    expect(prompt.split('Terse replies').length - 1).toBe(1)
  })
})

describe('the blind sessions get none', () => {
  it('a plan session is handed its prompt back untouched', async () => {
    await withNotes()
    expect(await withMemories('plan', 'BASE', cwd, home)).toBe('BASE')
  })

  it('every session that reads what a planner reads stays as blind to the notes as the planner', async () => {
    await withNotes()
    for (const mode of ['docs', 'file-decisions', 'doc-migration', 'docs-map']) expect(await withMemories(mode, 'BASE', cwd, home), mode).toBe('BASE')
    for (const mode of ['chat', 'implement', 'code-plan', 'reconcile', 'cleanup']) expect(wantsMemories(mode), mode).toBe(true)
  })

  it('nothing on disk reads to nothing added, for any other mode', async () => {
    expect(await withMemories('implement', 'BASE', cwd, home)).toBe('BASE')
  })
})

describe('readMemorySources and memorySection', () => {
  it('a missing project index adds nothing', async () => {
    expect(await readMemorySources(cwd, home)).toEqual({ project: undefined })
    expect(memorySection({ project: undefined })).toBeUndefined()
  })

  it('a project note renders under its own heading', () => {
    expect(memorySection({ project: 'a project note' })).toContain('Project notes:')
    expect(memorySection({ project: 'a project note' })).toContain('a project note')
  })
})
