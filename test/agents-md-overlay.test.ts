// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import type { AgentsMdOffer } from '../src/chat/protocol'

const { AgentsMdOverlay } = await import('../src/chat/webview/agents-md-overlay')
const { AgentsMdAnsweredEvent } = await import('../src/chat/webview/events')

const move: AgentsMdOffer = {
  scope: 'user',
  claudePath: '/home/me/.claude/CLAUDE.md',
  agentsPath: '/home/me/AGENTS.md',
  text: '# Global Rules\n\n- **Never guess.** Find the truth.\n',
}

function overlay(): InstanceType<typeof AgentsMdOverlay> {
  const node = new AgentsMdOverlay()
  document.body.appendChild(node)
  return node
}

const buttons = (node: HTMLElement): string[] => [...node.querySelectorAll<HTMLButtonElement>('.actions button')].map((b) => b.textContent!.trim())

describe('AgentsMdOverlay', () => {
  it('stays_out_of_the_way_until_something_is_offered', () => {
    const node = overlay()
    expect(node.hidden).toBe(true)
    node.show(undefined)
    expect(node.hidden).toBe(true)
  })

  it('what_agents_md_will_read_is_rendered_as_markdown_not_shown_as_source', () => {
    const node = overlay()
    node.show(move)
    expect(node.hidden).toBe(false)
    const preview = node.querySelector('.preview')!
    expect(preview.querySelector('h1')?.textContent).toBe('Global Rules')
    expect(preview.querySelector('li strong')?.textContent).toBe('Never guess.')
  })

  it('a_short_file_is_offered_the_move_without_a_tidy_up', () => {
    const node = overlay()
    node.show(move)
    expect(buttons(node)).toEqual(['Move', 'Not now'])
  })

  it('a_long_file_is_offered_to_move_and_tidy_up_in_one_go', () => {
    const node = overlay()
    node.show({ ...move, tidyWords: 2100 })
    expect(buttons(node)).toEqual(['Move and tidy up', 'Move', 'Not now'])
    expect(node.querySelector('.lead')!.textContent).toContain('2100 words')
  })

  it('a_long_agents_md_with_nothing_to_move_is_offered_a_tidy_up_alone', () => {
    const node = overlay()
    const { claudePath: _, ...tidyOnly } = move
    node.show({ ...tidyOnly, tidyWords: 2100 })
    expect(buttons(node)).toEqual(['Tidy up', 'Not now'])
    expect(node.querySelector('h2')!.textContent).toBe('Tidy up your own AGENTS.md?')
  })

  it('each_button_answers_for_the_scope_shown_and_closes_the_overlay', () => {
    for (const [selector, expected] of [
      ['button.tidy', 'tidy'],
      ['button.move', 'move'],
      ['button.decline', 'decline'],
      ['button.close', 'later'],
    ] as const) {
      const node = overlay()
      const answers: string[] = []
      node.addEventListener(AgentsMdAnsweredEvent.type, (e) => answers.push(`${e.scope}:${e.answer}`))
      node.show({ ...move, tidyWords: 2100 })
      node.querySelector<HTMLButtonElement>(selector)!.click()
      expect(answers).toEqual([`user:${expected}`])
      expect(node.hidden).toBe(true)
    }
  })

  it('escape_puts_the_offer_off_until_the_next_window', () => {
    const node = overlay()
    const answers: string[] = []
    node.addEventListener(AgentsMdAnsweredEvent.type, (e) => answers.push(e.answer))
    node.show(move)
    node.querySelector('button.move')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(answers).toEqual(['later'])
  })
})
