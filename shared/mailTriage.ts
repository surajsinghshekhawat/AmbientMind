export interface MailPayload {
  mimeType?: string
  filename?: string
  headers?: { name: string; value: string }[]
  body?: { data?: string; size?: number }
  parts?: MailPayload[]
}

export interface TriagedMessage {
  sender: string
  subject: string
  body: string
  /** Gmail's label ids, including its inbox categories. */
  labels?: string[]
}

export function header(payload: MailPayload | undefined, name: string): string {
  const found = payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())
  return found?.value ?? ''
}

const BULK_SENDER = /(no-?reply|do-?not-?reply|notification|newsletter|mailer|bounce)@/i

/**
 * Cheap header-based triage. Bulk mail is the overwhelming majority of an inbox
 * and none of it contains tasks, so filtering here rather than in the prompt
 * removes most of the model's work before it starts. Gmail's Promotions tab
 * catches marketing sent without the bulk headers, which a model will still
 * read as "Register now" and turn into a task.
 */
export function shouldSkip(message: TriagedMessage, payload: MailPayload | undefined): string | null {
  if (header(payload, 'List-Unsubscribe')) return 'bulk: List-Unsubscribe'
  if (/^(bulk|list|junk|auto_reply)$/i.test(header(payload, 'Precedence'))) return 'bulk: Precedence'
  // Helpdesks such as Zendesk mark a person's reply auto-generated too, so a
  // reply in a thread is read; out-of-office answers (auto-replied) never are.
  const auto = header(payload, 'Auto-Submitted').toLowerCase()
  if (auto.startsWith('auto-') && !(auto.startsWith('auto-generated') && /^(?:\[[^\]]*\]\s*)?re:/i.test(message.subject.trim()))) {
    return 'bulk: Auto-Submitted'
  }
  if (message.labels?.includes('CATEGORY_PROMOTIONS')) return 'bulk: Gmail Promotions'
  if (BULK_SENDER.test(message.sender)) return 'bulk: sender address'
  if (message.body.length < 40) return 'too short to contain a task'
  if (message.body.length > 20_000) return 'too long; likely a digest'
  return null
}
