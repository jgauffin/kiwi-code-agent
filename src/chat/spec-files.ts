import { basename, relative } from 'node:path'
import { SPECS_DIR } from '../agent/phases/blind-plan'
import { frontMatterValue, statusOf } from '../agent/phases/spec-file'
import type { SpecStatus } from '../agent/phases/spec-status'

/**
 * A file badge in the explorer carries at most two characters, so a status
 * shows as a symbol with the full word on hover. Symbols rather than letters,
 * and no colour of their own: git writes letters and tints the file name in the
 * same place, and a spec's state is not a change to it.
 */
export type SpecBadge = { badge: string; tooltip: string }

const BADGES: Record<SpecStatus, SpecBadge> = {
  draft: { badge: '✎', tooltip: 'Draft spec: a proposal, not approved' },
  approved: { badge: '⚑', tooltip: 'Approved spec: the rules are settled, nothing built yet' },
  implemented: { badge: '⚙', tooltip: 'Implemented: every task is built, the tests have not passed yet' },
  // The emoji carries its own green: a theme colour on the decoration would tint the file name as well, which is git's to say.
  verified: { badge: '✅', tooltip: 'Verified: built and the test run passed' },
}

export function specBadge(status: SpecStatus): SpecBadge {
  return BADGES[status]
}

const SPEC_SUFFIX = '.spec.md'
const SPEC_FILE = new RegExp(`^${SPECS_DIR}/[^/]+\\.spec\\.md$`)

/** Whether a path is one of this workspace's specs: the only files the explorer badges. */
export function isSpecPath(workspaceRoot: string, path: string): boolean {
  return SPEC_FILE.test(relative(workspaceRoot, path).replaceAll('\\', '/'))
}

/** The feature a spec file plans, named as the planner knows it, and where it stands; undefined for any file that is not one of this workspace's specs. */
export function specFeatureOf(workspaceRoot: string, path: string, text: string): { feature: string; status: SpecStatus } | undefined {
  if (!isSpecPath(workspaceRoot, path)) return undefined
  return { feature: frontMatterValue(text, 'feature') ?? basename(path).slice(0, -SPEC_SUFFIX.length), status: statusOf(text) }
}

/** The feature of a spec still in draft, which is what the editor's planner button is offered for; undefined for anything else. */
export function draftFeatureOf(workspaceRoot: string, path: string, text: string): string | undefined {
  const spec = specFeatureOf(workspaceRoot, path, text)
  return spec?.status === 'draft' ? spec.feature : undefined
}
