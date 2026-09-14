/**
 * Unbounded producer/consumer queue exposed as an async iterable.
 * One consumer at a time. `end()` lets the consumer drain and then finish;
 * `fail()` rejects the consumer's next read.
 */
export class AsyncQueue<T> implements AsyncIterable<T> {
  private readonly buffer: T[] = []
  private waiter: { resolve: (r: IteratorResult<T>) => void; reject: (e: unknown) => void } | undefined
  private ended = false
  private failure: unknown

  push(item: T): void {
    if (this.ended) throw new Error('AsyncQueue: push after end')
    if (this.waiter) {
      const w = this.waiter
      this.waiter = undefined
      w.resolve({ value: item, done: false })
      return
    }
    this.buffer.push(item)
  }

  end(): void {
    if (this.ended) return
    this.ended = true
    if (this.waiter) {
      const w = this.waiter
      this.waiter = undefined
      w.resolve({ value: undefined, done: true })
    }
  }

  fail(error: unknown): void {
    if (this.ended) return
    this.failure = error
    this.ended = true
    if (this.waiter) {
      const w = this.waiter
      this.waiter = undefined
      w.reject(error)
    }
  }

  get isEnded(): boolean {
    return this.ended
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        const item = this.buffer.shift()
        if (item !== undefined) return Promise.resolve({ value: item, done: false })
        if (this.failure !== undefined) return Promise.reject(this.failure)
        if (this.ended) return Promise.resolve({ value: undefined, done: true })
        if (this.waiter) return Promise.reject(new Error('AsyncQueue: concurrent consumers'))
        return new Promise((resolve, reject) => {
          this.waiter = { resolve, reject }
        })
      },
      // A consumer leaving a `for await` early does not close the queue: it
      // is a live stream, and the consumer may come back for the rest.
      return: () => Promise.resolve({ value: undefined, done: true }),
    }
  }
}
