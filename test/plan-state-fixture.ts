import type { PlanState } from '../src/chat/protocol'

/** A fresh draft plan with nothing in it; a test names only what its rule is about. */
export function planState(over: Partial<PlanState> = {}): PlanState {
  return {
    specPath: 'specs/orders.spec.md',
    tasksPath: 'specs/orders.tasks.md',
    decisionsPath: 'specs/orders.decisions.md',
    stage: 'created',
    status: 'draft',
    body: '# Orders',
    spec: { title: 'Orders', goal: '', scenarios: [], questions: [], problems: [] },
    stale: false,
    repairable: false,
    checkable: false,
    implementable: false,
    verifiable: false,
    tasks: [],
    review: { rounds: [] },
    commentable: true,
    approvable: false,
    decisions: [],
    pendingDecisions: 0,
    applyingRulings: false,
    reviewingDocs: false,
    atWork: true,
    ...over,
  }
}
