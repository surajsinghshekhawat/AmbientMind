/**
 * What the network log records about one request. No query string, headers
 * or body: the log has to be safe to show and to keep.
 */
export interface NetworkRequest {
  at: string
  method: string
  host: string
  path: string
  /** HTTP status, or null when the request never got an answer. */
  status: number | null
  ms: number
  /** Main process `fetch`, or a window's own request. */
  via: 'main' | 'window'
}

export type Destination = 'google' | 'model-download' | 'this-mac' | 'other'

export interface DestinationSummary {
  destination: Destination
  hosts: string[]
  requests: number
  failed: number
  lastAt: string | null
}

export interface NetworkSummary {
  destinations: DestinationSummary[]
  /** Newest first, off-device requests only. */
  recent: NetworkRequest[]
  /** Requests to this Mac (Ollama, the sign-in callback) since launch. */
  localSinceLaunch: number
}

/** `host` or `host:port`, IPv6 bare or in brackets. */
function bareHostname(host: string): string {
  const name = host.toLowerCase()
  if (name.startsWith('[')) return name.slice(1, name.indexOf(']'))
  if (name.indexOf(':') !== name.lastIndexOf(':')) return name
  return name.replace(/:\d+$/, '')
}

function isLoopbackIp(name: string): boolean {
  if (name === '::1') return true
  const octets = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(name)
  return octets !== null && octets[1] === '127' && octets.slice(2).every((octet) => Number(octet) <= 255)
}

export function isLoopback(host: string): boolean {
  const name = bareHostname(host)
  return name === 'localhost' || isLoopbackIp(name)
}

export const DEFAULT_OLLAMA_URL = 'http://127.0.0.1:11434'

/**
 * Mail and screen text are sent to Ollama, so an override has to be plain
 * http to a loopback IP. A name, even `localhost`, resolves outside our control.
 */
export function localOllamaUrl(raw: string | undefined): string {
  if (!raw) return DEFAULT_OLLAMA_URL
  try {
    const url = new URL(raw)
    if (url.protocol === 'http:' && isLoopbackIp(bareHostname(url.host))) return url.origin
  } catch {
    // Falls through to the default.
  }
  console.warn(`[ollama] ignoring OLLAMA_URL=${raw}: only http://127.0.0.1 or http://[::1] is allowed`)
  return DEFAULT_OLLAMA_URL
}

export function destinationOf(host: string): Destination {
  const name = host.replace(/:\d+$/, '').toLowerCase()
  if (isLoopback(name)) return 'this-mac'
  if (name === 'google.com' || name.endsWith('.google.com') || name.endsWith('.googleapis.com')) return 'google'
  if (
    name.endsWith('huggingface.co') ||
    name.endsWith('hf.co') ||
    name.endsWith('jsdelivr.net') ||
    name.endsWith('unpkg.com') ||
    name.endsWith('projectnaptha.com') ||
    name === 'registry.ollama.ai' ||
    name.endsWith('.r2.cloudflarestorage.com')
  ) {
    return 'model-download'
  }
  return 'other'
}

export const DESTINATION_LABEL: Record<Destination, string> = {
  google: 'Google (Gmail and Calendar)',
  'model-download': 'Model downloads',
  'this-mac': 'This Mac',
  other: 'Somewhere else'
}

/** Strips the query and fragment, and long opaque ids, from a URL path. */
export function safePath(pathname: string): string {
  return pathname
    .split('/')
    .map((part) => (part.length > 24 && /^[\w-]+$/.test(part) ? '…' : part))
    .join('/')
}

export function summariseNetwork(
  requests: NetworkRequest[],
  localSinceLaunch: number,
  recentLimit = 50
): NetworkSummary {
  const byDestination = new Map<Destination, DestinationSummary>()
  for (const request of requests) {
    const destination = destinationOf(request.host)
    const summary = byDestination.get(destination) ?? {
      destination,
      hosts: [],
      requests: 0,
      failed: 0,
      lastAt: null
    }
    summary.requests += 1
    if (request.status === null || request.status >= 400) summary.failed += 1
    if (!summary.hosts.includes(request.host)) summary.hosts.push(request.host)
    if (!summary.lastAt || request.at > summary.lastAt) summary.lastAt = request.at
    byDestination.set(destination, summary)
  }
  const order: Destination[] = ['google', 'model-download', 'other', 'this-mac']
  return {
    destinations: order.flatMap((destination) => byDestination.get(destination) ?? []),
    recent: requests.slice(-recentLimit).reverse(),
    localSinceLaunch
  }
}
