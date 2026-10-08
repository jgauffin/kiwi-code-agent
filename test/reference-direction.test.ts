import { describe, expect, it } from 'vitest'
import { REFERENCE_DIRECTION, SPEC_READING, blindPlanPrompt } from '../src/agent/phases/blind-plan'
import { codePlanPrompt } from '../src/agent/phases/code-plan'
import { docMigrationPrompt } from '../src/agent/phases/doc-migration'

describe('which way references run', () => {
  it('a_session_that_changes_code_hears_that_code_never_cites_a_spec', () => {
    expect(SPEC_READING).toContain(REFERENCE_DIRECTION)
    expect(codePlanPrompt('/ws')).toContain(REFERENCE_DIRECTION)
  })

  it('a_session_that_may_edit_the_docs_hears_that_docs_never_cite_a_spec', () => {
    expect(blindPlanPrompt('Order cancellation', '/ws')).toContain(REFERENCE_DIRECTION)
    expect(docMigrationPrompt('/ws')).toContain(REFERENCE_DIRECTION)
  })
})
