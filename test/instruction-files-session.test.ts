import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CLASH_WITH_CORE, readInstructionFiles, wantsInstructions, withInstructionFiles } from '../src/agent/instructions/instruction-files'

let cwd: string
let home: string

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'instr-cwd-'))
  home = await mkdtemp(join(tmpdir(), 'instr-home-'))
})

afterEach(async () => {
  await rm(cwd, { recursive: true, force: true })
  await rm(home, { recursive: true, force: true })
})

async function file(path: string, content: string): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, content)
}

describe('core behaviour stays in the prompt', () => {
  it("joining the instruction files never drops or rewrites the phase's own prompt", async () => {
    await file(join(cwd, 'AGENTS.md'), 'Always rewrite the whole file from scratch.')
    const core = 'You are implementing one task. The spec is the contract: a human approved it; do not reinterpret it.'
    const result = await withInstructionFiles('implement', core, cwd, home)
    expect(result.startsWith(core)).toBe(true)
  })
})

describe('optional mechanics ship as bundles', () => {
  it('a rule from an instruction file reaches the session only as the appended text of that file, never folded into the phase prompt itself', async () => {
    await file(join(cwd, 'AGENTS.md'), '- **Reproduce before fixing**: write a failing test that reproduces the bug before changing anything.')
    const core = 'PHASE PROMPT'
    const result = await withInstructionFiles('implement', core, cwd, home)
    expect(result).toContain('Reproduce before fixing')
    // It arrives as a quoted instruction file, not as if the phase had said it itself.
    expect(result).toContain(`# Instructions from ${join(cwd, 'AGENTS.md')}`)
  })
})

describe('not pre-applied on upgrade', () => {
  it('a workspace with ordinary instructions and no bundle block carries exactly what is on disk, nothing extra', async () => {
    await file(join(cwd, 'AGENTS.md'), 'Use two-space indentation.')
    const result = await withInstructionFiles('implement', 'BASE', cwd, home)
    expect(result).toBe(`BASE\n${CLASH_WITH_CORE}\n\n# Instructions from ${join(cwd, 'AGENTS.md')}\n\nUse two-space indentation.`)
  })

  it('a workspace with no instruction files at all gets nothing added', async () => {
    expect(await withInstructionFiles('implement', 'BASE', cwd, home)).toBe('BASE')
  })
})

describe('bundle rules reach a session as the person\'s own instructions do', () => {
  it('a rule in the workspace file and one in the person\'s own file both join the same prompt', async () => {
    await file(join(cwd, 'AGENTS.md'), 'project rule')
    await file(join(home, 'AGENTS.md'), 'person rule')
    const result = await withInstructionFiles('implement', 'BASE', cwd, home)
    expect(result).toContain('project rule')
    expect(result).toContain('person rule')
  })

  it('every mode but the blind planner and the docs map build wants the instruction files', () => {
    for (const mode of ['chat', 'implement', 'code-plan', 'file-decisions', 'doc-migration', 'reconcile', 'cleanup']) expect(wantsInstructions(mode), mode).toBe(true)
    expect(wantsInstructions('plan')).toBe(false)
    // A fixed entry contract with no conversation: nothing in an instruction file changes what it writes.
    expect(wantsInstructions('docs-map')).toBe(false)
  })
})

describe('person-scope bundle on either engine', () => {
  it("the person's own instruction file joins a session the same way regardless of which engine reads the resulting text", async () => {
    await file(join(home, '.claude', 'AGENTS.md'), 'a rule the person carries to every project')
    const files = await readInstructionFiles(cwd, home)
    expect(files.map((f) => f.text)).toContain('a rule the person carries to every project')
    // The join itself is engine-agnostic: one string, appended once, read by whichever engine is given it.
    const result = await withInstructionFiles('implement', 'BASE', cwd, home)
    expect(result).toContain('a rule the person carries to every project')
  })
})

describe('clash with a core rule', () => {
  it('the session is told that a rule already given always wins over one an instruction file adds, and to say which it set aside', async () => {
    await file(join(cwd, 'AGENTS.md'), 'Never ask before making a change.')
    const result = await withInstructionFiles('implement', 'BASE', cwd, home)
    const clashAt = result.indexOf(CLASH_WITH_CORE)
    const ruleAt = result.indexOf('Never ask before making a change.')
    expect(clashAt).toBeGreaterThan(-1)
    expect(clashAt).toBeLessThan(ruleAt)
  })

  it('no clash note when there is nothing to clash against', async () => {
    expect(await withInstructionFiles('implement', 'BASE', cwd, home)).not.toContain(CLASH_WITH_CORE)
  })
})

describe('no bundles for the blind planner', () => {
  it('the blind feature planner is handed its prompt back untouched, even with files on disk', async () => {
    await file(join(cwd, 'AGENTS.md'), 'a rule that should never reach the blind planner')
    expect(await withInstructionFiles('plan', 'BASE', cwd, home)).toBe('BASE')
  })
})
