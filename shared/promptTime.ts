/**
 * Formats timestamps for prompts.
 *
 * A bare ISO timestamp forces the model to work out which weekday a date falls
 * on before it can resolve "Thursday" or "next Monday", and small models get
 * that wrong often enough to matter. So the weekday is always named.
 *
 * This applies to "now" in the instruction section only. Injecting the same
 * treatment into a message's own Date header was tried and measured: recall on
 * the eval corpus fell from 71% to 29%, because the boilerplate crowds out the
 * message itself. The extractor therefore keeps raw message dates.
 */
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function isoDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function stampOf(date: Date): string {
  return `${DAYS[date.getDay()]} ${isoDate(date)} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/**
 * For "now" in the instruction section, where relative phrasing needs
 * resolving and there is no message content to crowd out. Names the coming
 * week so picking a weekday is a lookup rather than a calculation.
 */
export function formatPromptTime(now: Date = new Date()): string {
  const upcoming = Array.from({ length: 7 }, (_, i) => {
    const day = new Date(now)
    day.setDate(now.getDate() + i + 1)
    return `${DAYS[day.getDay()]}=${isoDate(day)}`
  }).join(', ')

  return `${stampOf(now)}\nUpcoming dates: ${upcoming}`
}
