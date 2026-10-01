import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ensureAgentDirIgnored } from '../src/agent/agent-dir-ignore'

let cwd: string

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'agent-ignore-'))
})

afterEach(async () => {
  await rm(cwd, { recursive: true, force: true })
})

const gitignore = () => readFile(join(cwd, '.gitignore'), 'utf8')

describe('ensureAgentDirIgnored', () => {
  it('a_repository_whose_gitignore_misses_the_agent_folder_gets_it_appended', async () => {
    await mkdir(join(cwd, '.git'))
    await writeFile(join(cwd, '.gitignore'), 'node_modules/\n')
    expect(await ensureAgentDirIgnored(cwd)).toBe('added')
    expect(await gitignore()).toBe('node_modules/\n.kiwi/\n')
  })

  it('the_last_line_is_kept_whole_when_the_file_lacks_a_trailing_newline', async () => {
    await mkdir(join(cwd, '.git'))
    await writeFile(join(cwd, '.gitignore'), 'dist')
    await ensureAgentDirIgnored(cwd)
    expect(await gitignore()).toBe('dist\n.kiwi/\n')
  })

  it('a_repository_without_a_gitignore_gets_one', async () => {
    // A worktree or submodule has a `.git` file, not a folder.
    await writeFile(join(cwd, '.git'), 'gitdir: ../elsewhere\n')
    expect(await ensureAgentDirIgnored(cwd)).toBe('added')
    expect(await gitignore()).toBe('.kiwi/\n')
  })

  it('a_gitignore_that_already_covers_the_agent_folder_is_left_alone', async () => {
    await mkdir(join(cwd, '.git'))
    for (const line of ['.kiwi', '.kiwi/', '/.kiwi/', '.kiwi/**']) {
      await writeFile(join(cwd, '.gitignore'), `${line}\n`)
      expect(await ensureAgentDirIgnored(cwd), line).toBe('present')
      expect(await gitignore()).toBe(`${line}\n`)
    }
  })

  it('a_folder_that_is_not_a_repository_is_not_given_a_gitignore', async () => {
    expect(await ensureAgentDirIgnored(cwd)).toBe('no-repo')
    expect(existsSync(join(cwd, '.gitignore'))).toBe(false)
  })
})
