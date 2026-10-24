/** The rows of background commands and scheduled returns shown so far, by key. */
export class BackgroundRows {
  private readonly rows = new Map<string, HTMLElement>()

  clear(): void {
    this.rows.clear()
  }

  /** The row of a key; made and put in the transcript by `insert` the first time it is asked for. */
  rowFor(key: string, insert: (row: HTMLElement) => void): HTMLElement {
    let row = this.rows.get(key)
    if (!row) {
      row = document.createElement('article')
      this.rows.set(key, row)
      insert(row)
    }
    return row
  }
}
