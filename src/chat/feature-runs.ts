import type { SessionManager } from '../agent/session/session-manager'
import type { Limits } from '../agent/cleanup/oversized'
import type { CommandRunner, VerifyRule } from '../agent/phases/verification'

/** A per-session on/off switch the composer shows. */
export interface SessionSwitch {
  isEnabled(sessionId: string): boolean
  setEnabled(sessionId: string, enabled: boolean): void
}

/** The test run: its rules from settings, read when it starts, and the shell that runs them. */
export interface Verifier {
  rules(): VerifyRule[]
  run: CommandRunner
  /** Consecutive failed runs handed to the implementer before the failed record is left for the user. */
  failureBudget(): number
  /** Seconds a run whose failures are all foreign waits before running the same suites again (`kiwiAgent.verifyRetrySeconds`). */
  retrySeconds(): number
}

/** The cleanup after a feature's tests pass: its size limits and what never gets measured, from settings, read when the run starts. */
export interface SizeLimits {
  limits(): Limits
  /** Globs, workspace-relative, of files the measure passes over: generated code. */
  ignore(): string[]
}

/** What a feature run does when its state moved: bring every tab up to date, and tell the Sessions view. */
export interface ChatRefresh {
  sendState(): Promise<void>
  changed(): void
}

/** What the user is told, and asked, outside the tab. */
export interface Notify {
  warn(text: string): void
  error(text: string): void
  /** A modal question; undefined when it was dismissed. */
  ask(text: string, ...choices: string[]): Promise<string | undefined>
}

/** The session operations a feature run needs. */
export type RunSessions = Pick<
  SessionManager,
  'create' | 'send' | 'close' | 'settle' | 'retryFix' | 'get' | 'list' | 'latest' | 'isLive' | 'liveChildOf' | 'transcript' | 'takeCutOff'
>
