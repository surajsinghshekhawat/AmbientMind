/**
 * Pause is a wall-clock timestamp, not a boolean, so a process that stays up
 * past the hour cannot remain paused by forgetting to flip a flag.
 */

export function normalizePauseAiUntil(value: unknown, now = Date.now()): string | null {
  if (typeof value !== 'string' || !value.trim()) return null
  const ms = Date.parse(value)
  if (!Number.isFinite(ms) || ms <= now) return null
  return new Date(ms).toISOString()
}

export function isAiPaused(until: string | null | undefined, now = Date.now()): boolean {
  if (!until) return false
  const ms = Date.parse(until)
  return Number.isFinite(ms) && ms > now
}

/** Far enough ahead to mean "until resumed" while staying a timestamp. */
export const PAUSE_UNTIL_RESUMED = '9999-12-31T00:00:00.000Z'

export function isPausedUntilResumed(until: string | null | undefined): boolean {
  return !!until && Date.parse(until) >= Date.parse(PAUSE_UNTIL_RESUMED)
}

/** 8 am tomorrow, local time. */
export function tomorrowMorning(now = Date.now()): string {
  const next = new Date(now)
  next.setDate(next.getDate() + 1)
  next.setHours(8, 0, 0, 0)
  return next.toISOString()
}

export function pauseAiForHours(hours = 1, now = Date.now()): string {
  return new Date(now + hours * 3_600_000).toISOString()
}

export function describePause(until: string, now = Date.now()): string {
  return `AI paused ${pauseEnds(until, now)}. Recurring tasks still appear.`
}

/** "until 3:00 PM", "until tomorrow at 8:00 AM", "until you resume it". */
export function pauseEnds(until: string, now = Date.now()): string {
  if (isPausedUntilResumed(until)) return 'until you resume it'
  const when = new Date(until)
  const time = when.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  const today = new Date(now)
  const tomorrow = new Date(now)
  tomorrow.setDate(tomorrow.getDate() + 1)
  const day =
    when.toDateString() === today.toDateString()
      ? ''
      : when.toDateString() === tomorrow.toDateString()
        ? 'tomorrow at '
        : `${when.toLocaleDateString(undefined, { weekday: 'long' })} at `
  return `until ${day}${time}`
}
