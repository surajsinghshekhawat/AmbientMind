/**
 * What an app instance under unattended QA may do. Pure, so the rules are
 * tested without Electron; electron/qa.ts applies them.
 */

/** QA instances only ever run on a copy inside a run folder. */
export function qaFolderAllowed(dataDir: string | undefined, liveDataDir?: string): boolean {
  if (!dataDir) return false
  const normal = normalise(dataDir)
  if (!/\/\.local\/qa\/runs\/[^/]+\/.+/.test(`${normal}/`)) return false
  if (liveDataDir && normal === normalise(liveDataDir)) return false
  return !/\/\.local\/data(\/|$)/.test(normal)
}

/** Resolves `.` and `..` so a path can't climb out of the run folder. */
function normalise(path: string): string {
  const parts: string[] = []
  for (const part of path.replace(/\\/g, '/').split('/')) {
    if (part === '..') parts.pop()
    else if (part !== '.' && part !== '') parts.push(part)
  }
  return `/${parts.join('/')}`
}

export interface QaRequest {
  url: string
  method?: string | undefined
  /** Only read for the token endpoint. */
  body?: string | undefined
}

export type QaVerdict = { allowed: true } | { allowed: false; reason: string }

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])

/**
 * Your real Gmail and Calendar may be read and the access token refreshed;
 * nothing may be written, revoked or signed in again, and no other host is
 * reachable. Pages the app loads itself (file:, data:, devtools:) pass.
 */
export function qaRequestAllowed(request: QaRequest): QaVerdict {
  let url: URL
  try {
    url = new URL(request.url)
  } catch {
    return { allowed: false, reason: 'not a URL' }
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:' && url.protocol !== 'ws:' && url.protocol !== 'wss:') {
    return { allowed: true }
  }
  if (LOOPBACK.has(url.hostname)) return { allowed: true }

  const method = (request.method ?? 'GET').toUpperCase()
  const host = url.hostname
  const path = url.pathname
  if (method === 'GET' || method === 'HEAD') {
    if (host === 'gmail.googleapis.com' && path.startsWith('/gmail/v1/')) return { allowed: true }
    if (host === 'www.googleapis.com' && path.startsWith('/calendar/v3/')) return { allowed: true }
    if (host === 'www.googleapis.com' && path === '/oauth2/v3/userinfo') return { allowed: true }
  }
  if (method === 'POST' && host === 'oauth2.googleapis.com' && path === '/token') {
    return new URLSearchParams(request.body ?? '').get('grant_type') === 'refresh_token'
      ? { allowed: true }
      : { allowed: false, reason: 'only a token refresh may reach Google’s token endpoint' }
  }
  if (host.endsWith('googleapis.com') || host.endsWith('google.com')) {
    return { allowed: false, reason: `${method} to Google is not a read` }
  }
  return { allowed: false, reason: `${host} is off this machine and not on the QA allow list` }
}

/** The body of a fetch, when it's something we can read without consuming a stream. */
export function readableBody(body: unknown): string | undefined {
  if (typeof body === 'string') return body
  if (body instanceof URLSearchParams) return body.toString()
  return undefined
}
