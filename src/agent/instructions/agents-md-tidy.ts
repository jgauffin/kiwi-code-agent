import { DOCS_DIR } from '../phases/blind-plan'
import { ownText, type BundleScope } from './bundles'

/**
 * Past this many words of its own an `AGENTS.md` is offered a tidy-up. It is
 * read into every turn, so length is paid on every task and dilutes the
 * rules that matter; below this it is not worth the person's attention.
 */
export const TIDY_WORDS = 1500

/** Words the person wrote, bundle blocks left out: those are maintained by their sources. */
export function ownWords(agentsText: string): number {
  return ownText(agentsText).split(/\s+/).filter((w) => w.length > 0).length
}

/**
 * The first message of the chat that tidies one `AGENTS.md`. `bundles` names
 * the shared rule sets the file holds; the agent has no notion of them, so
 * they are explained only when there are some.
 */
export function agentsMdTidyKickoff(scope: BundleScope, agentsPath: string, bundles: string[]): string {
  const elsewhere =
    scope === 'project'
      ? `Domain knowledge, architecture, feature behaviour, how-tos and long rationale move into \`${DOCS_DIR}/\`, into the doc that already covers the subject or a new one.`
      : 'Long guidance on one subject moves into a file of its own next to it.'
  const shared =
    bundles.length > 0
      ? `\n\nThe file also holds shared rule sets this extension installs from rule repositories: ${bundles.join(', ')}. Each starts at a \`<!-- bundle source="..." -->\` line and ends at a \`<!-- /bundle -->\` line, and the extension replaces everything between those two lines whenever the rule set updates, so an edit there would be lost. Leave those lines and everything between them untouched, and do not count them toward the goal.`
      : ''
  return `Tidy up \`${agentsPath}\`. Both engines read it into every turn, so each line costs context on every task. The goal is under ${TIDY_WORDS} words.

Its reader is a reasoning model. It needs the facts and decisions it cannot work out from the code or the docs, each stated once as the outcome wanted, and its own judgment does the rest. Enumerated edge cases, forbidden phrasings and repeated emphasis add length, not signal.

First, say the same in fewer words, keeping every rule's meaning. Only where that is not enough, move things out, starting with what fewest tasks need: ${elsewhere} \`AGENTS.md\` keeps a one-line pointer saying when to read it. Rules that contradict each other or are too vague to act on, name with a fix.${shared}

Propose first: the tightened text, then anything that still has to move. Write nothing until I agree.`
}
