import type { ModelProfile, Provider } from './model-profile'

/**
 * Where a conversation is compacted unless the user says otherwise. Every
 * request re-sends the whole conversation, so one near a 1M window costs many
 * times one at this size; the window stays headroom rather than a target.
 */
export const DEFAULT_COMPACT_AT_TOKENS = 700_000

/**
 * The ceiling a session runs with: its provider's own for the model, the
 * global setting otherwise. Looked up when the session starts, so a session
 * made before the limit was set follows it too.
 */
export function compactAtFor(profile: Pick<ModelProfile, 'apiKeySecret' | 'model'>, providers: Provider[], fallbackTokens: number): number {
  const provider = providers.find((p) => p.name === profile.apiKeySecret)
  return provider?.compactAtTokens?.[profile.model] ?? fallbackTokens
}

/**
 * The size at which a conversation is compacted: the engine's share of its
 * window, or the user's ceiling when that comes first. A ceiling of 0 means none.
 */
export function compactionPoint(windowTokens: number, share: number, ceilingTokens = 0): number {
  const byWindow = Math.floor(windowTokens * share)
  return ceilingTokens > 0 ? Math.min(byWindow, ceilingTokens) : byWindow
}
