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

/**
 * What a live QA run (AMBIENTMIND_QA_LIVE=1) may create and then delete: a
 * Reminders list, an Apple calendar and a Google calendar by this name, and
 * nothing else of yours.
 */
export const QA_LIVE_TITLE = 'AmbientMind QA'

/** Google calendars this run may write to: the ones titled QA_LIVE_TITLE. */
export interface QaLiveGoogle {
  calendars: ReadonlySet<string>
}

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])
const CALENDARS = '/calendar/v3/calendars'

/**
 * Your real Gmail and Calendar may be read and the access token refreshed;
 * nothing may be written, revoked or signed in again, and no other host is
 * reachable. Pages the app loads itself (file:, data:, devtools:) pass.
 * A live run may also create a QA_LIVE_TITLE calendar and write to it alone.
 */
export function qaRequestAllowed(request: QaRequest, live?: QaLiveGoogle): QaVerdict {
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
  if (live && host === 'www.googleapis.com' && liveCalendarWrite(method, path, request.body, live)) return { allowed: true }
  if (host.endsWith('googleapis.com') || host.endsWith('google.com')) {
    return { allowed: false, reason: `${method} to Google is not a read` }
  }
  return { allowed: false, reason: `${host} is off this machine and not on the QA allow list` }
}

function liveCalendarWrite(method: string, path: string, body: string | undefined, live: QaLiveGoogle): boolean {
  if (method === 'POST' && path === CALENDARS) {
    try {
      return (JSON.parse(body ?? '') as { summary?: unknown }).summary === QA_LIVE_TITLE
    } catch {
      return false
    }
  }
  if (!path.startsWith(`${CALENDARS}/`)) return false
  const [rawId, ...rest] = path.slice(CALENDARS.length + 1).split('/')
  let id: string
  try {
    id = decodeURIComponent(rawId ?? '')
  } catch {
    return false
  }
  if (!live.calendars.has(id)) return false
  if (rest.length === 0) return method === 'DELETE'
  return rest[0] === 'events' && rest.length <= 2 && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)
}

/** The body of a fetch, when it's something we can read without consuming a stream. */
export function readableBody(body: unknown): string | undefined {
  if (typeof body === 'string') return body
  if (body instanceof URLSearchParams) return body.toString()
  return undefined
}
