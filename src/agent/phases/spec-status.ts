/**
 * What the spec's front matter says about where its feature stands. The stage
 * in `plan-stage` is derived from the working files and is the live word while
 * they exist; the status mirrors it into the committed spec, so it survives the
 * sweep that deletes them and is what a reader of the repository alone sees.
 */
export type SpecStatus = 'draft' | 'approved' | 'implemented' | 'verified'

const ORDER = ['draft', 'approved', 'implemented', 'verified'] as const

/** Anything the front matter does not name is a draft: a spec claims no more than it says. */
export function parseSpecStatus(value: string | undefined): SpecStatus {
  return ORDER.find((status) => status === value) ?? 'draft'
}

/** The human approved the rules, so they are what the product says rather than a proposal. */
export const isSettled = (status: SpecStatus): boolean => status !== 'draft'

/** Every task is built and the test run passed: the feature takes no further build work. */
export const isVerified = (status: SpecStatus): boolean => status === 'verified'

/**
 * How a draft came to be: planned with the person in conversation, drafted
 * from the docs by the migration job, or written by hand with nothing on
 * either session recording it. Drives how complete the pick-up list takes it
 * to be, and, once picked up, how deep its critique goes.
 */
export type Authorship = 'planned' | 'drafted' | 'hand-written'

const AUTHORSHIP_ORDER = ['planned', 'drafted', 'hand-written'] as const

/** Nothing recorded counts as hand-written, the least complete of the three. */
export function parseAuthorship(value: string | undefined): Authorship {
  return AUTHORSHIP_ORDER.find((a) => a === value) ?? 'hand-written'
}
