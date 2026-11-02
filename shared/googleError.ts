/**
 * Turns a failed Google API response into a line a person can read in
 * Settings. Google's own message is kept (the scope check matches on it), the
 * JSON around it is not.
 */
export function describeGoogleError(service: 'Gmail' | 'Calendar', status: number, body: string): string {
  const said = googleMessage(body)
  if (status === 429 || /rate limit|quota/i.test(said)) {
    return `${service}: Google is limiting requests for now; it will try again later`
  }
  if (status >= 500) return `${service}: Google had a problem on its side (${status}); it will try again next sync`
  return said ? `${service} ${status}: ${said}` : `${service} ${status}`
}

/** A 403 for missing scopes, from either API. */
export function isScopeError(message: string): boolean {
  return /insufficient authentication scopes|ACCESS_TOKEN_SCOPE_INSUFFICIENT/i.test(message)
}

function googleMessage(body: string): string {
  try {
    const message = (JSON.parse(body) as { error?: { message?: unknown } })?.error?.message
    if (typeof message === 'string') return message.trim()
  } catch {
    // Not JSON: an HTML error page or plain text.
  }
  const text = body.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
  return text.length > 160 ? `${text.slice(0, 159)}…` : text
}
