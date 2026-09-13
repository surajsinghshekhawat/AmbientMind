/**
 * Decides whether a spoken (or typed) utterance means "look at my screen"
 * rather than "create a task from these words".
 *
 * Kept as a pure function so the same rules apply to voice and to typed
 * shortcuts, and so the rules can be unit-tested without Electron.
 */
const SCREEN_INTENT = [
  /\b(add|make|create|capture|file|save)\b.{0,40}\b(on|from)\b.{0,20}\b(my |the )?screen\b/i,
  /\b(what('s| is)|whats)\b.{0,20}\bon\b.{0,10}\b(my |the )?screen\b.{0,30}\b(task|todo|list)?\b/i,
  /\b(screen|this|that)\b.{0,20}\b(as |to )?(a )?(task|todo)\b/i,
  /\bcapture\b.{0,20}\b(the |my )?screen\b/i,
  /\badd\b.{0,20}\bthis\b.{0,20}\b(to )?(my )?(tasks?|todos?|list)\b/i,
  /\b(see|look at|read|check)\b.{0,30}\b(my |the )?screen\b/i,
  /\b(my |the )?screen\b.{0,40}\b(task|deadline|tomorrow|remind)\b/i
]

export function isScreenCaptureIntent(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) return false
  return SCREEN_INTENT.some((pattern) => pattern.test(trimmed))
}
