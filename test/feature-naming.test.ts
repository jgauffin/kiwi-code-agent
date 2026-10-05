import { describe, expect, it } from 'vitest'
import { nameFrom, suggestFeatureName, type Namer } from '../src/agent/phases/feature-naming'

/** Answers every prompt with `answer`, keeping what it was asked so the prompt can be read back. */
function namer(answer: string): Namer & { asked: string[] } {
  const asked: string[] = []
  const ask = (prompt: string) => {
    asked.push(prompt)
    return Promise.resolve(answer)
  }
  return Object.assign(ask, { asked })
}

describe('reading a name out of what the model answered', () => {
  it('takes_the_name_as_it_stands', () => {
    expect(nameFrom('Order cancellation')).toBe('Order cancellation')
  })

  it('drops_the_quoting_and_the_list_marker_a_model_reaches_for', () => {
    expect(nameFrom('- "Order cancellation"')).toBe('Order cancellation')
    expect(nameFrom('**Order cancellation**')).toBe('Order cancellation')
  })

  it('keeps_the_first_line_when_the_model_explained_itself_anyway', () => {
    expect(nameFrom('Order cancellation\n\nThis names the feature because...')).toBe('Order cancellation')
  })

  it('cuts_a_name_that_runs_on_past_being_one', () => {
    expect(nameFrom('Cancelling an order that has not yet been shipped or billed to the buyer')).toBe('Cancelling an order that has not')
  })
})

describe('suggesting a feature name', () => {
  it('tells_the_model_which_names_are_taken_so_it_does_not_offer_one_of_them', async () => {
    const ask = namer('Order refunds')
    await suggestFeatureName(ask, 'As a buyer I want my money back', ['Order cancellation'])
    expect(ask.asked[0]).toContain('- Order cancellation')
    expect(ask.asked[0]).toContain('As a buyer I want my money back')
  })

  it('numbers_a_name_the_model_offered_that_is_taken_anyway_rather_than_refusing_it', async () => {
    const name = await suggestFeatureName(namer('Order cancellation'), 'Cancelling orders', ['Order cancellation'])
    expect(name).toBe('Order cancellation 2')
  })

  it('numbers_past_every_taken_variant_rather_than_landing_on_one_of_them', async () => {
    const name = await suggestFeatureName(namer('Order cancellation'), 'Cancelling orders', ['Order cancellation', 'Order cancellation 2'])
    expect(name).toBe('Order cancellation 3')
  })

  it('counts_a_name_taken_when_it_differs_only_in_spelling', async () => {
    const name = await suggestFeatureName(namer('Order cancellation'), 'Cancelling orders', ['order, cancellation!'])
    expect(name).toBe('Order cancellation 2')
  })

  it('refuses_rather_than_filling_the_field_with_nothing_when_no_name_came_back', async () => {
    await expect(suggestFeatureName(namer('\n\n'), 'Cancelling orders', [])).rejects.toThrow('answered without a name')
  })
})
