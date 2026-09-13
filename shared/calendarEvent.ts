import { occurrencesWithin, type RecurrenceRule } from './recurrence'

/** Google's BYDAY codes, indexed by Date#getDay(). */
const BYDAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const

/** A commitment needs a length to appear as a block rather than a pin. */
const DEFAULT_DURATION_MINUTES = 30

export interface CalendarEventBody {
  summary: string
  description: string
  start: { dateTime: string; timeZone: string }
  end: { dateTime: string; timeZone: string }
  recurrence: string[]
}

/**
 * Local wall-clock, deliberately not an ISO instant.
 *
 * Google pairs a naive date-time with an IANA zone, and that pairing is what
 * makes "tuition at five" survive travel and daylight saving. Sending a UTC
 * instant instead would pin the event to whatever offset happened to apply on
 * the day it was written.
 */
function wallClock(at: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}` +
    `T${pad(at.getHours())}:${pad(at.getMinutes())}:00`
  )
}

export function ruleToEvent(
  rule: Pick<RecurrenceRule, 'title' | 'weekdays' | 'time'>,
  options: { from: Date; timeZone: string; durationMinutes?: number }
): CalendarEventBody | null {
  // Anchored on a real occurrence so the first instance is never a day the
  // rule does not actually fall on.
  const first = occurrencesWithin(rule, options.from, 7)[0]
  if (!first) return null

  const minutes = options.durationMinutes ?? DEFAULT_DURATION_MINUTES
  const end = new Date(first.getTime() + minutes * 60_000)
  const days = [...new Set(rule.weekdays)].sort((a, b) => a - b).map((day) => BYDAY[day])

  return {
    summary: rule.title,
    description: 'Created by AmbientMind from a recurring rule.',
    start: { dateTime: wallClock(first), timeZone: options.timeZone },
    end: { dateTime: wallClock(end), timeZone: options.timeZone },
    recurrence: [`RRULE:FREQ=WEEKLY;BYDAY=${days.join(',')}`]
  }
}
