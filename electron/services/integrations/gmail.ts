import { googleFetch } from '../googleAuth'
import type { MessageInput } from '../ollama'

const API = 'https://gmail.googleapis.com/gmail/v1/users/me'

export interface GmailMessage extends MessageInput {
  id: string
  threadId: string
}

interface GmailPayload {
  mimeType?: string
  filename?: string
  headers?: { name: string; value: string }[]
  body?: { data?: string; size?: number }
  parts?: GmailPayload[]
}

interface GmailFull {
  id: string
  threadId: string
  internalDate?: string
  payload?: GmailPayload
}

function header(payload: GmailPayload | undefined, name: string): string {
  const found = payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())
  return found?.value ?? ''
}

function decode(data: string | undefined): string {
  if (!data) return ''
  return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
}

/** Depth-first walk preferring text/plain; HTML is a fallback, not a supplement. */
function extractBody(payload: GmailPayload | undefined): string {
  if (!payload) return ''

  const plain: string[] = []
  const html: string[] = []

  const walk = (node: GmailPayload) => {
    // Attachments carry a filename and are never useful as prompt input.
    if (node.filename) return
    if (node.mimeType === 'text/plain') plain.push(decode(node.body?.data))
    else if (node.mimeType === 'text/html') html.push(decode(node.body?.data))
    node.parts?.forEach(walk)
  }
  walk(payload)

  const text = plain.length > 0 ? plain.join('\n') : stripHtml(html.join('\n'))
  return text.replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim()
}

/**
 * Quoted history is where most false positives come from: a stale "can you send
 * me X" from three replies ago reads exactly like a fresh request.
 */
function stripQuotedReplies(body: string): string {
  const markers = [
    /^On .{10,80}wrote:$/m,
    /^-{2,}\s*Original Message\s*-{2,}$/im,
    /^_{5,}$/m,
    /^From:.*$/m
  ]
  let cut = body.length
  for (const marker of markers) {
    const match = marker.exec(body)
    if (match && match.index < cut) cut = match.index
  }
  return body.slice(0, cut).trim()
}

const BULK_SENDER = /(no-?reply|do-?not-?reply|notification|newsletter|mailer|bounce)@/i

/**
 * Cheap header-based triage. Bulk mail is the overwhelming majority of an inbox
 * and none of it contains tasks, so filtering here rather than in the prompt
 * removes most of the model's work before it starts.
 */
export function shouldSkip(message: GmailMessage, payload: GmailPayload | undefined): string | null {
  if (header(payload, 'List-Unsubscribe')) return 'bulk: List-Unsubscribe'
  if (/^(bulk|list|junk|auto_reply)$/i.test(header(payload, 'Precedence'))) return 'bulk: Precedence'
  if (header(payload, 'Auto-Submitted').startsWith('auto-')) return 'bulk: Auto-Submitted'
  if (BULK_SENDER.test(message.sender)) return 'bulk: sender address'
  if (message.body.length < 40) return 'too short to contain a task'
  if (message.body.length > 20_000) return 'too long; likely a digest'
  return null
}

async function json<T>(url: string): Promise<T> {
  const response = await googleFetch(url)
  if (!response.ok) {
    throw new Error(`Gmail ${response.status}: ${(await response.text()).slice(0, 200)}`)
  }
  return (await response.json()) as T
}

/**
 * Gmail returns at most 500 ids per call and far fewer by default, so a single
 * request silently truncates a busy day. Because the caller's window is
 * `newer_than:2d`, anything past the cap was not merely delayed — it aged out
 * of the query before it was ever seen, with nothing surfaced to the user.
 *
 * Paging is bounded rather than exhaustive: the extraction budget is the real
 * limit on a pass, and an unbounded loop over a first sync on an old mailbox
 * would spend minutes listing mail it is not going to read.
 */
const PAGE_SIZE = 100
const MAX_PAGES = 5

export async function listRecentMessageIds(
  query = 'newer_than:2d -in:chats',
  maxPages = MAX_PAGES
): Promise<{ id: string; threadId: string }[]> {
  const collected: { id: string; threadId: string }[] = []
  let pageToken: string | undefined

  for (let page = 0; page < maxPages; page++) {
    const params = new URLSearchParams({ maxResults: String(PAGE_SIZE), q: query })
    if (pageToken) params.set('pageToken', pageToken)

    const data = await json<{
      messages?: { id: string; threadId: string }[]
      nextPageToken?: string
    }>(`${API}/messages?${params.toString()}`)

    collected.push(...(data.messages ?? []))
    if (!data.nextPageToken) return collected
    pageToken = data.nextPageToken
  }

  console.warn(`[gmail] stopped after ${maxPages} pages; ${collected.length} ids listed`)
  return collected
}

export async function fetchMessage(id: string): Promise<{
  message: GmailMessage
  payload: GmailPayload | undefined
}> {
  const full = await json<GmailFull>(`${API}/messages/${id}?format=full`)
  const payload = full.payload
  const body = stripQuotedReplies(extractBody(payload))

  return {
    payload,
    message: {
      id: full.id,
      threadId: full.threadId,
      sender: header(payload, 'From'),
      recipients: [header(payload, 'To'), header(payload, 'Cc')].filter(Boolean).join('; '),
      sentAt: header(payload, 'Date') || new Date(Number(full.internalDate ?? 0)).toISOString(),
      subject: header(payload, 'Subject'),
      body
    }
  }
}

export async function getProfileEmail(): Promise<string> {
  return (await json<{ emailAddress: string }>(`${API}/profile`)).emailAddress
}
