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

export function pauseAiForHours(hours = 1, now = Date.now()): string {
  return new Date(now + hours * 3_600_000).toISOString()
}

export function describePause(until: string): string {
  const when = new Date(until)
  const time = when.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  return `AI paused until ${time}. Recurring tasks still appear.`
}
