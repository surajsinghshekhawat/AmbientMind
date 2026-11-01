/** Far more than any prompt uses; the rest of a huge HTML mail is never read. */
export const MAX_HTML_CHARS = 512_000

const BLOCK_END = new Set(['p', 'div', 'tr', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'])
const SKIPPED = new Set(['style', 'script'])

/**
 * HTML mail to plain text in one pass. Regular expressions with lazy or
 * open-ended spans go quadratic on a crafted message (thousands of `<style`
 * with no close), and a mail is something anyone can send you.
 */
export function stripHtml(html: string): string {
  const input = html.length > MAX_HTML_CHARS ? html.slice(0, MAX_HTML_CHARS) : html
  const lower = input.toLowerCase()
  let out = ''
  let at = 0
  while (at < input.length) {
    const open = input.indexOf('<', at)
    if (open === -1) {
      out += input.slice(at)
      break
    }
    out += input.slice(at, open)
    const close = input.indexOf('>', open + 1)
    if (close === -1) {
      // Not a tag after all: "a < b" in text.
      out += input.slice(open)
      break
    }
    const tag = lower.slice(open + 1, Math.min(close, open + 12))
    const closing = tag.startsWith('/')
    const name = /^\/?([a-z][a-z0-9]*)/.exec(tag)?.[1] ?? ''
    if (!closing && SKIPPED.has(name)) {
      const end = lower.indexOf(`</${name}`, close + 1)
      if (end === -1) break
      const endClose = input.indexOf('>', end)
      at = endClose === -1 ? input.length : endClose + 1
      out += ' '
      continue
    }
    out += name === 'br' || (closing && BLOCK_END.has(name)) ? '\n' : ' '
    at = close + 1
  }
  return out
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
}
