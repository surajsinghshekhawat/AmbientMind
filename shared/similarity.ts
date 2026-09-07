const STOPWORDS = new Set([
  'a', 'an', 'the', 'to', 'for', 'of', 'and', 'on', 'in', 'at', 'by', 'with',
  'from', 'about', 'please', 'my', 'our', 'your', 'this', 'that', 'it'
])

export function contentTokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((word) => word.length > 1 && !STOPWORDS.has(word))
  )
}

/**
 * Dice coefficient over content words. Used both to score extraction against
 * gold labels and to detect that two sources produced the same task, so the two
 * always agree on what "the same task" means.
 */
export function similarity(a: string, b: string): number {
  const ta = contentTokens(a)
  const tb = contentTokens(b)
  if (ta.size === 0 || tb.size === 0) return 0
  let shared = 0
  for (const token of ta) if (tb.has(token)) shared++
  return (2 * shared) / (ta.size + tb.size)
}
