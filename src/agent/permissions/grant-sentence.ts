import type { Grant, GrantScope } from './grants'

/**
 * A kept answer as one sentence. The prompt, the Permissions settings list,
 * the phone and the exported transcript all word a grant with this, so what
 * the person agreed to reads the same wherever they meet it again.
 */
export function grantSentence(grant: Grant, scope: GrantScope): string {
  const who = grant.workspace !== undefined ? `Every session in the workspace ${grant.workspace}` : WHO[scope]
  const what = grant.action !== undefined ? ACTION[grant.action] : `run ${commandText(grant)}`
  const where = placeText(grant)
  return grant.verdict === 'allow' ? `${who} may ${what} ${where} without asking.` : `${who} is refused when it would ${what} ${where}.`
}

const WHO: Record<GrantScope, string> = {
  session: 'This session',
  workspace: 'Every session in this workspace',
  person: 'Every session in every workspace',
}

const ACTION: Record<'read' | 'write', string> = { read: 'read files', write: 'write files' }

function commandText(grant: Grant): string {
  const words = [...(grant.command ?? []), ...(grant.flags ?? [])].join(' ')
  return grant.flags?.length ? `\`${words}\`` : `\`${words}\`, with any flags,`
}

function placeText(grant: Grant): string {
  switch (grant.reach) {
    case 'file':
      return `on ${grant.place}`
    case 'directory':
      return `in ${grant.place} (not the folders below it)`
    case 'tree':
      return `in ${grant.place} and every folder below it`
  }
}
