import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { StringDecoder } from 'node:string_decoder'
import {
  HELPER_PROTOCOL,
  HelperError,
  LineDecoder,
  encodeRequest,
  parseMessage,
  restartDelay,
  type HelloResult,
  type HelperMethod,
  type HelperMethods
} from '@shared/helperProtocol'

/**
 * Talks to the Swift helper over stdin/stdout. Plain Node, no Electron, so it
 * is tested against a fake helper.
 *
 * The helper is an optional extra: every caller has a fallback, so a missing,
 * crashed or mismatched helper turns into a prompt `unavailable` error rather
 * than a hang. A crash restarts it with backoff; a binary that is missing or
 * speaks another protocol version is not retried.
 */

export type HelperState = 'stopped' | 'starting' | 'ready' | 'unavailable'

export interface HelperClientOptions {
  command: string
  args?: string[]
  env?: NodeJS.ProcessEnv
  requestTimeoutMs?: number
  helloTimeoutMs?: number
  /** Up this long without crashing and the backoff starts over. */
  stableAfterMs?: number
  restartDelay?: (failures: number) => number
  log?: (message: string) => void
}

interface Pending {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}

interface Waiter {
  resolve: () => void
  reject: (error: Error) => void
}

export class HelperClient extends EventEmitter {
  private child: ChildProcessWithoutNullStreams | null = null
  private pending = new Map<number, Pending>()
  private waiters: Waiter[] = []
  private nextId = 1
  private failures = 0
  private restartTimer: NodeJS.Timeout | null = null
  private stableTimer: NodeJS.Timeout | null = null
  private stopping = false
  private _state: HelperState = 'stopped'
  private _hello: HelloResult | null = null
  private _reason: string | null = null

  constructor(private readonly options: HelperClientOptions) {
    super()
  }

  get state(): HelperState {
    return this._state
  }

  /** What the running helper said about itself. */
  get hello(): HelloResult | null {
    return this._hello
  }

  /** Why the helper is unavailable, for logs and diagnostics. */
  get reason(): string | null {
    return this._reason
  }

  start(): void {
    if (this._state !== 'stopped') return
    this.stopping = false
    this.launch()
  }

  async stop(): Promise<void> {
    this.stopping = true
    this.clearTimers()
    this.rejectWaiters(new HelperError('unavailable', 'The helper was stopped'))
    const child = this.child
    if (child) {
      const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()))
      child.stdin.end()
      const forced = setTimeout(() => child.kill('SIGKILL'), 1000)
      await exited
      clearTimeout(forced)
    }
    this.setState('stopped')
  }

  async request<M extends HelperMethod>(
    method: M,
    params: HelperMethods[M]['params'],
    options: { timeoutMs?: number } = {}
  ): Promise<HelperMethods[M]['result']> {
    const timeoutMs = options.timeoutMs ?? this.options.requestTimeoutMs ?? 10_000
    const started = Date.now()
    await this.whenReady(timeoutMs)
    return (await this.send(method, params, Math.max(1, timeoutMs - (Date.now() - started)))) as HelperMethods[M]['result']
  }

  private whenReady(timeoutMs: number): Promise<void> {
    if (this._state === 'ready') return Promise.resolve()
    if (this._state === 'unavailable') {
      return Promise.reject(new HelperError('unavailable', this._reason ?? 'The helper is unavailable'))
    }
    if (this._state === 'stopped') return Promise.reject(new HelperError('unavailable', 'The helper is not running'))
    return new Promise<void>((resolve, reject) => {
      const waiter: Waiter = {
        resolve: () => {
          clearTimeout(timer)
          resolve()
        },
        reject: (error) => {
          clearTimeout(timer)
          reject(error)
        }
      }
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w !== waiter)
        reject(new HelperError('timeout', 'The helper did not start in time'))
      }, timeoutMs)
      this.waiters.push(waiter)
    })
  }

  private send(method: string, params: unknown, timeoutMs: number): Promise<unknown> {
    const child = this.child
    if (!child) return Promise.reject(new HelperError('unavailable', 'The helper is not running'))
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new HelperError('timeout', `The helper took longer than ${timeoutMs} ms to answer ${method}`))
      }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      child.stdin.write(encodeRequest({ id, method, params: params ?? {} }))
    })
  }

  private launch() {
    this.setState('starting')
    let child: ChildProcessWithoutNullStreams
    try {
      child = spawn(this.options.command, this.options.args ?? [], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: this.options.env ?? process.env
      })
    } catch (err) {
      return this.giveUp(`Could not start the helper: ${(err as Error).message}`)
    }
    this.child = child

    const lines = new LineDecoder()
    const utf8 = new StringDecoder('utf8')
    child.stdout.on('data', (chunk: Buffer) => {
      for (const line of lines.push(utf8.write(chunk))) this.handleLine(line)
    })
    child.stderr.on('data', (chunk: Buffer) => this.log(`stderr: ${chunk.toString().trim()}`))
    // A write after the helper died fails asynchronously; the exit handler deals with it.
    child.stdin.on('error', () => {})

    child.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT' || err.code === 'EACCES') {
        this.child = null
        this.giveUp(`The helper binary is missing or not executable (${err.code})`)
      }
    })
    child.once('exit', (code, signal) => this.handleExit(child, code, signal))

    void this.send('hello', {}, this.options.helloTimeoutMs ?? 5000).then(
      (result) => {
        if (this.child !== child) return
        const hello = result as HelloResult
        if (hello?.protocol !== HELPER_PROTOCOL) {
          this.giveUp(`The helper speaks protocol ${hello?.protocol}, the app ${HELPER_PROTOCOL}`)
          child.kill()
          return
        }
        this._hello = hello
        this._reason = null
        this.setState('ready')
        const waiters = this.waiters
        this.waiters = []
        for (const waiter of waiters) waiter.resolve()
        this.stableTimer = setTimeout(() => (this.failures = 0), this.options.stableAfterMs ?? 60_000)
      },
      (err: Error) => {
        if (this.child !== child) return
        this.log(`hello failed: ${err.message}`)
        child.kill('SIGKILL')
      }
    )
  }

  private handleLine(line: string) {
    const message = parseMessage(line)
    if (!message) return this.log(`ignored a malformed line: ${line.slice(0, 120)}`)
    if ('event' in message) {
      this.emit('event', message.event, message.data)
      return
    }
    if (message.id === null) return this.log(`helper error without a request: ${message.ok ? '' : message.error.message}`)
    const pending = this.pending.get(message.id)
    if (!pending) return
    this.pending.delete(message.id)
    clearTimeout(pending.timer)
    if (message.ok) pending.resolve(message.result)
    else pending.reject(new HelperError(message.error.code, message.error.message))
  }

  private handleExit(child: ChildProcessWithoutNullStreams, code: number | null, signal: NodeJS.Signals | null) {
    if (this.child === child) this.child = null
    if (this.stableTimer) clearTimeout(this.stableTimer)
    this.stableTimer = null
    this._hello = null
    const gone = new HelperError('unavailable', 'The helper stopped before answering')
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(gone)
    }
    this.pending.clear()
    this.emit('exit', code, signal)
    if (this.stopping || this._state === 'unavailable') return

    this.failures += 1
    const delay = (this.options.restartDelay ?? restartDelay)(this.failures)
    this.log(`exited (code ${code}, signal ${signal}); restarting in ${delay} ms`)
    this.setState('starting')
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null
      if (!this.stopping) this.launch()
    }, delay)
  }

  private giveUp(reason: string) {
    this._reason = reason
    this.log(reason)
    this.clearTimers()
    this.setState('unavailable')
    const error = new HelperError('unavailable', reason)
    this.rejectWaiters(error)
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pending.clear()
  }

  private rejectWaiters(error: HelperError) {
    const waiters = this.waiters
    this.waiters = []
    for (const waiter of waiters) waiter.reject(error)
  }

  private clearTimers() {
    if (this.restartTimer) clearTimeout(this.restartTimer)
    if (this.stableTimer) clearTimeout(this.stableTimer)
    this.restartTimer = null
    this.stableTimer = null
  }

  private setState(state: HelperState) {
    if (this._state === state) return
    this._state = state
    this.emit('state', state)
  }

  private log(message: string) {
    this.options.log?.(message)
  }
}
