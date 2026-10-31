export type ErrorSink = (where: string, err: unknown) => void

let sink: ErrorSink = (where, err) => console.error(`[${where}]`, err)

/** Main points this at the crash log once the app's paths are known. */
export function setErrorSink(next: ErrorSink) {
  sink = next
}

/**
 * Wraps a fire-and-forget callback (an `ipcMain.on` handler, a timer, a power
 * event) so a throw or rejection is recorded instead of reaching the process
 * as an uncaught exception. `ipcMain.handle` needs none of this: Electron
 * already returns its errors to the caller as a rejected promise.
 */
export function guard<A extends unknown[]>(
  where: string,
  fn: (...args: A) => unknown
): (...args: A) => void {
  return (...args) => {
    try {
      const result = fn(...args)
      if (result instanceof Promise) result.catch((err: unknown) => sink(where, err))
    } catch (err) {
      sink(where, err)
    }
  }
}

/** Counts events in a sliding window; `hit` turns true once there are `limit` of them. */
export class BurstLimiter {
  private hits: number[] = []

  constructor(
    private readonly limit: number,
    private readonly windowMs: number
  ) {}

  hit(now = Date.now()): boolean {
    this.hits = this.hits.filter((at) => now - at < this.windowMs)
    this.hits.push(now)
    return this.hits.length >= this.limit
  }
}
