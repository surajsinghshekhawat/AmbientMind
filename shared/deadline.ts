/**
 * Normalises whatever the model emits for a deadline into an ISO timestamp.
 *
 * The JSON schema can only require that the deadline is a string, so the model
 * sometimes returns a real date and sometimes a phrase it copied off the
 * screen: "Thursday", "tomorrow", "EOD". Prompting alone did not make this
 * consistent, and a bare weekday is unambiguous enough to resolve in code,
 * which is cheaper and always gives the same answer.
 */
const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']

/** A deadline stated as a day means the end of that working day, not midnight. */
const END_OF_DAY_HOUR = 17

function atEndOfDay(date: Date): Date {
  const out = new Date(date)
  out.setHours(END_OF_DAY_HOUR, 0, 0, 0)
  return out
}

/** Date-only strings parse as UTC midnight, which is the wrong instant here. */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

export function resolveDeadline(raw: unknown, now: Date = new Date()): string | null {
  if (typeof raw !== 'string') return null

  const text = raw.trim().toLowerCase()
  if (!text || text === 'null' || text === 'none') return null

  if (DATE_ONLY.test(text)) {
    const [y, m, d] = text.split('-').map(Number)
    return atEndOfDay(new Date(y!, m! - 1, d!)).toISOString()
  }

  const parsed = new Date(raw)
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString()

  if (text === 'today' || text === 'eod' || text === 'end of day') {
    return atEndOfDay(now).toISOString()
  }

  if (text === 'tomorrow') {
    const out = new Date(now)
    out.setDate(now.getDate() + 1)
    return atEndOfDay(out).toISOString()
  }

  // A bare weekday means the next one still ahead of us. "Thursday" said on a
  // Thursday means the one coming, not the day already underway.
  const dayIndex = DAYS.findIndex((day) => text === day || text === `next ${day}`)
  if (dayIndex >= 0) {
    const out = new Date(now)
    const delta = (dayIndex - now.getDay() + 7) % 7
    out.setDate(now.getDate() + (delta === 0 ? 7 : delta))
    return atEndOfDay(out).toISOString()
  }

  return null
}
