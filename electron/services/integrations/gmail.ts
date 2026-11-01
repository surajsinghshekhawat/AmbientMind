import { describeGoogleError } from '@shared/googleError'
import { stripHtml } from '@shared/html'
import { header, type MailPayload as GmailPayload } from '@shared/mailTriage'
import { googleFetch } from '../googleAuth'
import type { MessageInput } from '../extract'

export { shouldSkip } from '@shared/mailTriage'

const API = 'https://gmail.googleapis.com/gmail/v1/users/me'

export interface GmailMessage extends MessageInput {
  id: string
  threadId: string
  labels?: string[]
}

interface GmailFull {
  id: string
  threadId: string
  internalDate?: string
  labelIds?: string[]
  payload?: GmailPayload
}

function decode(data: string | undefined): string {
  if (!data) return ''
  return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
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

async function json<T>(url: string): Promise<T> {
  const response = await googleFetch(url)
  if (!response.ok) {
    throw new Error(describeGoogleError('Gmail', response.status, await response.text()))
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
  const full = await json<GmailFull>(`${API}/messages/${encodeURIComponent(id)}?format=full`)
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
      body,
      ...(full.labelIds ? { labels: full.labelIds } : {})
    }
  }
}

export async function getProfileEmail(): Promise<string> {
  return (await json<{ emailAddress: string }>(`${API}/profile`)).emailAddress
}
