import { appendFileSync, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import type { Session } from 'electron'
import { isLoopback, safePath, summariseNetwork, type NetworkRequest, type NetworkSummary } from '@shared/network'

/**
 * Every request that leaves the Mac, one JSON line each, so "local-only" is
 * something the user can check rather than take on trust. Requests to this
 * Mac (Ollama, the sign-in callback) are counted but not written: Ollama is
 * polled for status, and those lines would bury the ones that matter.
 */

const KEEP_LINES = 5000
const TRIM_ABOVE_BYTES = 1_000_000

let logPath: string | null = null
let localSinceLaunch = 0

export function readRequests(path: string): NetworkRequest[] {
  if (!existsSync(path)) return []
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as NetworkRequest]
      } catch {
        return []
      }
    })
}

function record(url: string, method: string, status: number | null, started: number, via: NetworkRequest['via']) {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return
  if (isLoopback(parsed.hostname)) {
    localSinceLaunch += 1
    return
  }
  if (!logPath) return
  const entry: NetworkRequest = {
    at: new Date().toISOString(),
    method: method.toUpperCase(),
    host: parsed.host,
    path: safePath(parsed.pathname),
    status,
    ms: Math.round(Date.now() - started),
    via
  }
  try {
    appendFileSync(logPath, `${JSON.stringify(entry)}\n`)
  } catch (err) {
    console.warn('[net] could not write the network log:', (err as Error).message)
  }
}

function urlOf(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  return input.url
}

/** Wraps the main process's `fetch` and, when given, a session's requests. */
export function installNetworkLog(path: string, sessions: Session[] = []): void {
  logPath = path
  try {
    if (existsSync(path) && statSync(path).size > TRIM_ABOVE_BYTES) {
      const kept = readFileSync(path, 'utf8').split('\n').filter(Boolean).slice(-KEEP_LINES)
      writeFileSync(path, `${kept.join('\n')}\n`)
    }
  } catch (err) {
    console.warn('[net] could not trim the network log:', (err as Error).message)
  }

  const original = globalThis.fetch
  if (!(original as { logged?: boolean }).logged) {
    const logged = async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const started = Date.now()
      const url = urlOf(input)
      const method = init?.method ?? (input instanceof Request ? input.method : 'GET')
      try {
        const response = await original(input, init)
        record(url, method, response.status, started, 'main')
        return response
      } catch (err) {
        record(url, method, null, started, 'main')
        throw err
      }
    }
    Object.assign(logged, { logged: true })
    globalThis.fetch = logged as typeof fetch
  }

  for (const session of sessions) {
    const filter = { urls: ['http://*/*', 'https://*/*'] }
    const starts = new Map<number, number>()
    session.webRequest.onSendHeaders(filter, (details) => starts.set(details.id, Date.now()))
    session.webRequest.onCompleted(filter, (details) => {
      record(details.url, details.method, details.statusCode, starts.get(details.id) ?? Date.now(), 'window')
      starts.delete(details.id)
    })
    session.webRequest.onErrorOccurred(filter, (details) => {
      record(details.url, details.method, null, starts.get(details.id) ?? Date.now(), 'window')
      starts.delete(details.id)
    })
  }
}

export function networkLogPath(): string {
  if (!logPath) throw new Error('The network log is not installed')
  return logPath
}

export function networkSummary(): NetworkSummary {
  return summariseNetwork(logPath ? readRequests(logPath) : [], localSinceLaunch)
}

export function clearNetworkLog(): void {
  if (logPath && existsSync(logPath)) writeFileSync(logPath, '')
}
