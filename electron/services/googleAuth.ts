import { createHash, randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import { app, shell } from 'electron'
import { getJson, setJson, deleteSecret } from './secrets'

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
const REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke'

const TOKEN_KEY = 'google.tokens'
/** Refresh slightly early so a long sync cannot start on an expiring token. */
const EXPIRY_SKEW_MS = 60_000

export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/calendar.readonly',
  'openid',
  'email'
]

interface StoredTokens {
  accessToken: string
  refreshToken: string
  expiresAt: number
  scope: string
  email?: string
}

export interface GoogleCredentials {
  clientId: string
  clientSecret: string
}

export class GoogleAuthError extends Error {}

/**
 * Desktop OAuth clients are not confidential: the "secret" ships with the app
 * and Google treats it as an identifier, which is why PKCE carries the actual
 * security. Read from env first so development never needs a file on disk.
 */
export function credentialsFilePath() {
  return join(app.getPath('userData'), 'google-credentials.json')
}

export function loadCredentials(): GoogleCredentials | null {
  const fromEnv = process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
  if (fromEnv) {
    return {
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!
    }
  }

  for (const path of [credentialsFilePath(), join(app.getAppPath(), 'google-credentials.json')]) {
    try {
      const raw = JSON.parse(readFileSync(path, 'utf8')) as {
        installed?: { client_id: string; client_secret: string }
        web?: { client_id: string; client_secret: string }
        clientId?: string
        clientSecret?: string
      }
      // Accepts the JSON that Google Cloud Console hands you verbatim.
      const node = raw.installed ?? raw.web
      if (node) return { clientId: node.client_id, clientSecret: node.client_secret }
      if (raw.clientId && raw.clientSecret) {
        return { clientId: raw.clientId, clientSecret: raw.clientSecret }
      }
    } catch {
      continue
    }
  }
  return null
}

function pkcePair() {
  const verifier = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  return { verifier, challenge }
}

/**
 * Google rejects embedded webviews, so consent has to happen in the system
 * browser and come back over a loopback listener on an ephemeral port.
 *
 * Chrome (and Edge) also hit `/favicon.ico` on that port. That request has no
 * `state` or `code`, and an earlier version treated it as a CSRF failure and
 * closed the server — the real callback then got ERR_CONNECTION_REFUSED.
 */
function awaitAuthorizationCode(expectedState: string): {
  port: Promise<number>
  code: Promise<string>
  close: () => void
} {
  let resolvePort!: (port: number) => void
  let resolveCode!: (code: string) => void
  let rejectCode!: (err: Error) => void
  let settled = false

  const port = new Promise<number>((resolve) => (resolvePort = resolve))
  const code = new Promise<string>((resolve, reject) => {
    resolveCode = resolve
    rejectCode = reject
  })

  const finish = (ok: string | null, err?: Error) => {
    if (settled) return
    settled = true
    if (err) rejectCode(err)
    else resolveCode(ok!)
    // Delay close so the browser can fetch favicon / retry without racing us.
    setTimeout(() => server.close(), 1500)
  }

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    console.log('[oauth]', req.method, url.pathname, [...url.searchParams.keys()].join(','))

    const respond = (message: string) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(
        `<!doctype html><meta charset="utf-8"><title>AmbientMind</title>` +
          `<body style="font:15px system-ui;padding:3rem;color:#222">${message}</body>`
      )
    }

    // Ignore noise: favicon, DevTools, speculative GETs with no OAuth params.
    const error = url.searchParams.get('error')
    const received = url.searchParams.get('code')
    if (!error && !received) {
      res.writeHead(204)
      res.end()
      return
    }

    if (error) {
      respond('Authorisation was declined. You can close this tab.')
      finish(null, new GoogleAuthError(`Google returned: ${error}`))
      return
    }

    if (url.searchParams.get('state') !== expectedState) {
      respond('Authorisation failed a security check. You can close this tab.')
      finish(null, new GoogleAuthError('OAuth state mismatch'))
      return
    }

    respond('AmbientMind is connected. You can close this tab.')
    finish(received)
  })

  server.on('error', (err) => finish(null, err))
  server.listen(0, '127.0.0.1', () => resolvePort((server.address() as AddressInfo).port))
  const timer = setTimeout(
    () => finish(null, new GoogleAuthError('Timed out waiting for Google authorisation')),
    10 * 60_000
  )
  void code.finally(() => clearTimeout(timer)).catch(() => {})

  return { port, code, close: () => server.close() }
}

async function exchange(body: Record<string, string>): Promise<StoredTokens> {
  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body)
  })

  const data = (await response.json()) as {
    access_token?: string
    refresh_token?: string
    expires_in?: number
    scope?: string
    error?: string
    error_description?: string
  }

  if (!response.ok || !data.access_token) {
    throw new GoogleAuthError(data.error_description ?? data.error ?? 'Token exchange failed')
  }

  return {
    accessToken: data.access_token,
    // A refresh grant does not return a new refresh token; keep the existing one.
    refreshToken: data.refresh_token ?? getJson<StoredTokens>(TOKEN_KEY)?.refreshToken ?? '',
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
    scope: data.scope ?? GOOGLE_SCOPES.join(' ')
  }
}

let connectInFlight: Promise<{ email?: string }> | null = null

export async function connectGoogle(): Promise<{ email?: string }> {
  if (connectInFlight) return connectInFlight

  connectInFlight = (async () => {
    const credentials = loadCredentials()
    if (!credentials) {
      throw new GoogleAuthError(
        'No Google OAuth client found. See docs/google-setup.md to create one.'
      )
    }

    const state = randomBytes(16).toString('hex')
    const { verifier, challenge } = pkcePair()
    const listener = awaitAuthorizationCode(state)
    const port = await listener.port
    const redirectUri = `http://127.0.0.1:${port}`

    const url = new URL(AUTH_ENDPOINT)
    url.search = new URLSearchParams({
      client_id: credentials.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: GOOGLE_SCOPES.join(' '),
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state,
      // Required to receive a refresh token at all, and to receive one again if
      // the user has already granted consent previously.
      access_type: 'offline',
      prompt: 'consent'
    }).toString()

    await shell.openExternal(url.toString())

    try {
      const code = await listener.code
      const tokens = await exchange({
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
        code,
        code_verifier: verifier,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri
      })

      const email = await fetchEmailAddress(tokens.accessToken)
      setJson(TOKEN_KEY, { ...tokens, ...(email ? { email } : {}) })
      return email ? { email } : {}
    } finally {
      listener.close()
    }
  })().finally(() => {
    connectInFlight = null
  })

  return connectInFlight
}

async function fetchEmailAddress(accessToken: string): Promise<string | undefined> {
  try {
    const response = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` }
    })
    if (!response.ok) return undefined
    return ((await response.json()) as { email?: string }).email
  } catch {
    return undefined
  }
}

export function isGoogleConnected(): boolean {
  return Boolean(getJson<StoredTokens>(TOKEN_KEY)?.refreshToken)
}

export function connectedGoogleAccount(): string | null {
  return getJson<StoredTokens>(TOKEN_KEY)?.email ?? null
}

export async function disconnectGoogle(): Promise<void> {
  const tokens = getJson<StoredTokens>(TOKEN_KEY)
  if (tokens?.refreshToken) {
    // Best effort: the local token is cleared regardless of the server's reply.
    await fetch(REVOKE_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: tokens.refreshToken })
    }).catch(() => undefined)
  }
  deleteSecret(TOKEN_KEY)
}

let refreshInFlight: Promise<string> | null = null

/**
 * Returns a valid access token, refreshing when necessary. Concurrent callers
 * share one refresh: the sync scheduler fires Gmail and Calendar together, and
 * two simultaneous refreshes would race to overwrite the stored token.
 */
export async function getAccessToken(): Promise<string> {
  const tokens = getJson<StoredTokens>(TOKEN_KEY)
  if (!tokens?.refreshToken) throw new GoogleAuthError('Google account is not connected')

  if (tokens.accessToken && Date.now() < tokens.expiresAt - EXPIRY_SKEW_MS) {
    return tokens.accessToken
  }

  refreshInFlight ??= (async () => {
    const credentials = loadCredentials()
    if (!credentials) throw new GoogleAuthError('Google OAuth client configuration is missing')

    const refreshed = await exchange({
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      refresh_token: tokens.refreshToken,
      grant_type: 'refresh_token'
    })
    setJson(TOKEN_KEY, { ...refreshed, ...(tokens.email ? { email: tokens.email } : {}) })
    return refreshed.accessToken
  })().finally(() => {
    refreshInFlight = null
  })

  return refreshInFlight
}

/** Authorised fetch against a Google API, with one retry on a stale token. */
export async function googleFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const call = async (token: string) =>
    fetch(url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${token}` } })

  let response = await call(await getAccessToken())
  if (response.status === 401) {
    const tokens = getJson<StoredTokens>(TOKEN_KEY)
    if (tokens) setJson(TOKEN_KEY, { ...tokens, expiresAt: 0 })
    response = await call(await getAccessToken())
  }
  return response
}
