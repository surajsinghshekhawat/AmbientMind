/**
 * Every task the model proposes carries a quote from the message it came from.
 * Models paraphrase even when told to copy, so the quote is checked against
 * the source and, when it isn't there, replaced by the source's own sentence
 * that best supports the task. Evidence shown to the user is always text that
 * really is in the message.
 */

export interface Evidence {
  /** Verbatim text from the source, or null when nothing in it supports the task. */
  quote: string | null
  /** The model's own quote was found in the source. */
  verified: boolean
}

export type ConfidenceBucket = 'high' | 'medium' | 'low'

const MAX_QUOTE = 240
const MIN_QUOTE = 6

const STOPWORDS = new Set(
  'the and for you your with this that from have has are was were will would can could please about into than then them they our out its it’s also just get got let'.split(
    ' '
  )
)

/** Lowercase, straight quotes, single spaces; `map[i]` is the source index of character `i`. */
function normalise(text: string): { text: string; map: number[] } {
  let out = ''
  const map: number[] = []
  let space = true
  for (let i = 0; i < text.length; i++) {
    let ch = text[i]!
    if (/\s/.test(ch)) {
      if (space) continue
      ch = ' '
      space = true
    } else {
      space = false
      ch = ch.replace(/[‘’`]/g, "'").replace(/[“”]/g, '"').toLowerCase()
    }
    out += ch
    map.push(i)
  }
  if (out.endsWith(' ')) {
    out = out.slice(0, -1)
    map.pop()
  }
  return { text: out, map }
}

function trimQuote(text: string): string {
  return text.trim().replace(/^["'“‘\s]+|["'”’\s]+$/g, '')
}

function clip(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length <= MAX_QUOTE ? flat : `${flat.slice(0, MAX_QUOTE - 1).trimEnd()}…`
}

function words(text: string): Set<string> {
  return new Set(
    (text.toLowerCase().match(/[\p{L}\p{N}']{3,}/gu) ?? []).filter((word) => !STOPWORDS.has(word))
  )
}

function sentences(source: string): string[] {
  return source
    .split(/(?<=[.!?])\s+|\n+/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 8 && !/^(?:on .+ wrote:|>)/i.test(part))
}

export function findEvidence(claimed: string | null | undefined, source: string, title: string): Evidence {
  const quote = trimQuote(claimed ?? '')
  if (quote.length >= MIN_QUOTE) {
    const haystack = normalise(source)
    const needle = normalise(quote).text
    const at = haystack.text.indexOf(needle)
    if (at >= 0) {
      const start = haystack.map[at]!
      const end = haystack.map[at + needle.length - 1]! + 1
      return { quote: clip(source.slice(start, end)), verified: true }
    }
    // A greeting or a joined line break around a real sentence is still a copy.
    const copied = sentences(source)
      .filter((sentence) => {
        const own = normalise(sentence).text
        return own.length >= needle.length * 0.6 && needle.includes(own)
      })
      .sort((a, b) => b.length - a.length)[0]
    if (copied) return { quote: clip(copied), verified: true }
  }

  // Not in the message: point at the sentence that shares the most words with
  // what the model claimed and the task it wrote.
  const wanted = words(`${quote} ${title}`)
  if (wanted.size === 0) return { quote: null, verified: false }
  let best: { text: string; score: number } | null = null
  for (const sentence of sentences(source)) {
    const have = words(sentence)
    let score = 0
    for (const word of wanted) if (have.has(word)) score++
    if (!best || score > best.score) best = { text: sentence, score }
  }
  const needed = Math.min(2, wanted.size)
  return best && best.score >= needed ? { quote: clip(best.text), verified: false } : { quote: null, verified: false }
}

/** Just under "high": a quote that had to be found for the model can't vouch for it. */
export const UNVERIFIED_CEILING = 0.84

export function bucketFor(confidence: number, verified: boolean): ConfidenceBucket {
  if (confidence >= 0.85 && verified) return 'high'
  if (confidence >= 0.7) return 'medium'
  return 'low'
}

/** Off unless a threshold is set; never for a task whose quote had to be found for it. */
export function shouldAutoAccept(confidence: number, verified: boolean, threshold: number | null): boolean {
  return threshold !== null && verified && confidence >= threshold
}
