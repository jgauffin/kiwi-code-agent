import type { SessionRecord } from '../agent/session/session-manager'
import { atEffort, switchedTo } from '../agent/session/model-profile'
import { codePlanBuildKickoff } from '../agent/phases/code-plan'
import type { FromWebview } from './protocol'
import type { MessageRouterDeps, WebviewMessage } from './message-router'

/** Messages about one run's own controls: permissions, questions, switches and the model it talks on. */
export async function handleRunMessage(deps: MessageRouterDeps, message: FromWebview, shown: SessionRecord | undefined): Promise<boolean> {
  switch (message.type) {
    case 'permission':
      await answerPermission(deps, message)
      return true
    case 'question':
      await answerQuestion(deps, message)
      return true
    case 'interrupt':
      await interruptRun(deps, message, shown)
      return true
    case 'compact':
      compactRun(deps, message, shown)
      return true
    case 'set_allow_writes':
      setAllowWrites(deps, message, shown)
      return true
    case 'set_session_model':
      await setSessionModel(deps, message, shown)
      return true
    case 'set_session_effort':
      await setSessionEffort(deps, message, shown)
      return true
    case 'approve_plan':
      await approvePlan(deps, shown)
      return true
    case 'reconnect_mcp':
      await reconnectMcp(deps, message, shown)
      return true
    case 'set_default_profile':
      await setDefaultProfile(deps, message)
      return true
    default:
      return false
  }
}

async function answerPermission(deps: MessageRouterDeps, message: WebviewMessage<'permission'>): Promise<void> {
  const { sessions, permissions } = deps
  if (!sessions.get(message.sessionId)) return
  // The rules are in place before the call runs, so a second call they cover in the same turn already passes.
  const { remember, ...decision } = message.decision
  if (remember?.project.length) await permissions.allowForProject(remember.project)
  if (remember?.session.length) await permissions.allowForSession(message.sessionId, remember.session)
  await sessions.respondToPermission(message.sessionId, message.requestId, decision)
}

async function answerQuestion(deps: MessageRouterDeps, message: WebviewMessage<'question'>): Promise<void> {
  if (deps.sessions.get(message.sessionId)) await deps.sessions.respondToQuestion(message.sessionId, message.requestId, message.outcome)
}

async function interruptRun(deps: MessageRouterDeps, message: WebviewMessage<'interrupt'>, shown: SessionRecord | undefined): Promise<void> {
  if (shown) await deps.sessions.interrupt(deps.tabView.targetOf(shown, message.sessionId, false).id)
}

function compactRun(deps: MessageRouterDeps, message: WebviewMessage<'compact'>, shown: SessionRecord | undefined): void {
  if (shown) deps.sessions.compact(deps.tabView.targetOf(shown, message.sessionId, false).id)
}

function setAllowWrites(deps: MessageRouterDeps, message: WebviewMessage<'set_allow_writes'>, shown: SessionRecord | undefined): void {
  if (shown) deps.allowWrites.setEnabled(deps.tabView.targetOf(shown, message.sessionId, false).id, message.enabled)
  void deps.sendState()
}

async function setSessionModel(deps: MessageRouterDeps, message: WebviewMessage<'set_session_model'>, shown: SessionRecord | undefined): Promise<void> {
  const offer = deps.registeredModels().find((m) => m.profile.name === message.name)
  if (shown && offer) await deps.tracker.switchProfile(shown.id, switchedTo(deps.tracker.switchingFrom(shown), offer))
  void deps.sendState()
}

async function setSessionEffort(deps: MessageRouterDeps, message: WebviewMessage<'set_session_effort'>, shown: SessionRecord | undefined): Promise<void> {
  if (shown) await deps.tracker.switchProfile(shown.id, atEffort(deps.tracker.switchingFrom(shown), message.effort))
  void deps.sendState()
}

async function approvePlan(deps: MessageRouterDeps, shown: SessionRecord | undefined): Promise<void> {
  // The approval is the go-ahead, so the build starts at once rather than waiting on another prompt.
  if (shown?.mode === 'code-plan' && shown.access !== 'full') {
    await deps.sessions.grantFullAccess(shown.id, deps.profileFor('code-build'))
    await deps.sessions.send(shown.id, codePlanBuildKickoff(), 'Plan approved: building it')
    await deps.sendState()
  }
}

async function reconnectMcp(deps: MessageRouterDeps, message: WebviewMessage<'reconnect_mcp'>, shown: SessionRecord | undefined): Promise<void> {
  if (shown) await deps.sessions.reconnectMcp(deps.tabView.targetOf(shown, message.sessionId, false).id, message.server)
}

async function setDefaultProfile(deps: MessageRouterDeps, message: WebviewMessage<'set_default_profile'>): Promise<void> {
  await deps.profileDefaults.set(message.name)
  await deps.sendState()
}
