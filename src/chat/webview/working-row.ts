/** What is being waited on, and whether the one to act is the user. */
export type Activity = { label: string; needsUser: boolean }

type Row = { element: HTMLElement; label: string; startedAt: number; stop: () => void }

/** The pulsing row naming the current activity, with the time spent in it. */
export class WorkingRow {
  private working: Row | undefined
  private current: Activity | undefined

  /** Drops the row's timer without touching the DOM, for a transcript that is being emptied. */
  clear(): void {
    this.working?.stop()
    this.working = undefined
    this.current = undefined
  }

  /** The row names the activity and is kept last in the host while the session is at work; it is gone when idle. */
  show(host: HTMLElement, activity: Activity | undefined, reveal: () => void): void {
    this.current = activity
    if (!activity) {
      this.working?.stop()
      this.working?.element.remove()
      this.working = undefined
      return
    }
    if (!this.working) this.working = this.createRow(reveal)
    if (this.working.label !== activity.label) {
      this.working.label = activity.label
      this.working.startedAt = Date.now()
      this.working.element.textContent = `${activity.label}…`
    }
    // A row that only fades reads as progress; the wait for the user has to stand out as a wait.
    this.working.element.classList.toggle('needs-user', activity.needsUser)
    this.working.element.title = activity.needsUser ? 'Show what it is waiting on' : ''
    host.appendChild(this.working.element)
  }

  private createRow(reveal: () => void): Row {
    const row = document.createElement('p')
    row.className = 'working'
    row.addEventListener('click', () => {
      if (this.current?.needsUser) reveal()
    })
    const working: Row = { element: row, label: '', startedAt: 0, stop: () => window.clearInterval(timer) }
    const timer = window.setInterval(() => {
      row.textContent = `${working.label}… ${Math.round((Date.now() - working.startedAt) / 1000)}s`
    }, 1000)
    return working
  }
}
