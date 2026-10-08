import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PersonRulesStore, personRulesFile, readPersonRules, writePersonRules } from '../src/agent/permissions/person-rules'

describe('person rules', () => {
  it('a_missing_file_is_no_rules_and_a_written_one_is_read_back', async () => {
    const home = await mkdtemp(join(tmpdir(), 'home-'))
    expect(await readPersonRules(home)).toEqual({ allow: [], deny: [] })
    await writePersonRules({ allow: ['Bash(cd D:/data)'], deny: ['Read(**/.ssh)'] }, home)
    expect(await readPersonRules(home)).toEqual({ allow: ['Bash(cd D:/data)'], deny: ['Read(**/.ssh)'] })
  })

  it('a_broken_file_is_read_as_no_rules_rather_than_thrown', async () => {
    const home = await mkdtemp(join(tmpdir(), 'home-'))
    await writePersonRules({ allow: ['x'], deny: [] }, home)
    const { writeFile } = await import('node:fs/promises')
    await writeFile(personRulesFile(home), 'not json')
    expect(await readPersonRules(home)).toEqual({ allow: [], deny: [] })
  })

  it('the_store_reads_once_at_start_up_and_answers_in_memory_from_then_on', async () => {
    const home = await mkdtemp(join(tmpdir(), 'home-'))
    await writePersonRules({ allow: ['Bash(cd D:/data)'], deny: [] }, home)
    const store = new PersonRulesStore(home)
    expect(store.get()).toEqual({ allow: [], deny: [] })
    await store.ready()
    expect(store.get()).toEqual({ allow: ['Bash(cd D:/data)'], deny: [] })
  })

  it('adding_a_rule_keeps_what_was_already_there_and_never_duplicates_it', async () => {
    const home = await mkdtemp(join(tmpdir(), 'home-'))
    const store = new PersonRulesStore(home)
    await store.add('allow', ['Bash(cd D:/data)'])
    await store.add('allow', ['Bash(cd D:/data)', 'Bash(cd D:/other)'])
    expect(store.get()).toEqual({ allow: ['Bash(cd D:/data)', 'Bash(cd D:/other)'], deny: [] })
    expect(await readPersonRules(home)).toEqual({ allow: ['Bash(cd D:/data)', 'Bash(cd D:/other)'], deny: [] })
  })

  it('setting_a_rule_list_replaces_it_whole_as_editing_it_by_hand_does', async () => {
    const home = await mkdtemp(join(tmpdir(), 'home-'))
    const store = new PersonRulesStore(home)
    await store.add('deny', ['Read(**/.ssh)'])
    await store.set('deny', ['Read(**/.aws)'])
    expect(store.get()).toEqual({ allow: [], deny: ['Read(**/.aws)'] })
  })

  it('the_rules_live_under_the_persons_home_directory_in_a_file_of_their_own', async () => {
    const home = 'D:\\home\\jonas'
    expect(personRulesFile(home).replace(/\\/g, '/')).toBe('D:/home/jonas/.kiwi/permissions.json')
  })

  it('a_write_to_the_file_is_persisted_as_formatted_json', async () => {
    const home = await mkdtemp(join(tmpdir(), 'home-'))
    await writePersonRules({ allow: ['Bash(cd D:/data)'], deny: [] }, home)
    const text = await readFile(personRulesFile(home), 'utf8')
    expect(JSON.parse(text)).toEqual({ allow: ['Bash(cd D:/data)'], deny: [] })
  })
})
