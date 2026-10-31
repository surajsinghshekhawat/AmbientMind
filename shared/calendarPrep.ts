import type { AppleEvent } from './helperProtocol'

/** How far ahead of a meeting the preparation task is due. */
export const PREP_LEAD_HOURS = 1

/**
 * Only meetings this close become tasks. A week of "Prepare for…" rows buried
 * the list; anything further out belongs in a calendar view, not a to-do list.
 */
export const PREP_LOOKAHEAD_HOURS = 48

export interface CalendarEvent {
  id: string
  /** Shared by every copy of the event, in any account or app. */
  iCalUID?: string
  summary?: string
  description?: string
  status?: string
  start?: { dateTime?: string; date?: string }
  end?: { dateTime?: string; date?: string }
  attendees?: {
    email?: string
    displayName?: string
    self?: boolean
    resource?: boolean
    responseStatus?: string
  }[]
  organizer?: { email?: string; displayName?: string; self?: boolean }
  eventType?: string
  recurringEventId?: string
  htmlLink?: string
}

export interface PrepTask {
  title: string
  deadline: string
  priority: 'high'
  source: 'gcalendar' | 'acalendar'
  sourceId: string
  people: string[]
  rawContext: string | null
  confidence: 1
}

/** Event types that are status markers, not meetings with other people. */
const NOT_MEETINGS = new Set(['focusTime', 'workingLocation', 'outOfOffice', 'birthday'])

function otherPeople(event: CalendarEvent) {
  return (event.attendees ?? []).filter((a) => !a.self && !a.resource)
}

/**
 * A calendar event becomes a task only when it needs preparation: a one-off,
 * timed meeting with other people, coming up soon, that the user has not
 * declined. All-day events, solo blocks and recurring series are routine and
 * stay in the calendar.
 *
 * Deterministic on purpose: spending a model call to turn "Call with Sarah at
 * 3pm" into a prep task would be slower and less reliable than this rule.
 */
export function prepTaskFor(
  event: CalendarEvent,
  now: Date,
  source: PrepTask['source'] = 'gcalendar'
): PrepTask | null {
  if (event.status === 'cancelled') return null
  if (event.eventType && NOT_MEETINGS.has(event.eventType)) return null
  if (event.recurringEventId) return null

  const title = event.summary?.trim()
  if (!title) return null

  const startsAt = event.start?.dateTime
  if (!startsAt) return null
  const start = Date.parse(startsAt)
  if (Number.isNaN(start)) return null
  if (start <= now.getTime() || start > now.getTime() + PREP_LOOKAHEAD_HOURS * 3_600_000) {
    return null
  }

  if (event.attendees?.some((a) => a.self && a.responseStatus === 'declined')) return null
  const others = otherPeople(event)
  if (others.length === 0) return null

  return {
    title: `Prepare for ${title}`,
    deadline: new Date(start - PREP_LEAD_HOURS * 3_600_000).toISOString(),
    priority: 'high',
    source,
    sourceId: event.id,
    people: others
      .map((a) => a.displayName ?? a.email ?? '')
      .filter(Boolean)
      .slice(0, 5),
    rawContext: event.description ?? null,
    confidence: 1
  }
}

/** EventKit's view of an event, in the shape the prep rule reads. */
export function fromAppleEvent(event: AppleEvent): CalendarEvent {
  const day = (iso: string) => iso.slice(0, 10)
  return {
    id: event.id,
    iCalUID: event.id,
    summary: event.title,
    ...(event.notes ? { description: event.notes } : {}),
    ...(event.cancelled ? { status: 'cancelled' } : {}),
    start: event.allDay ? { date: day(event.start) } : { dateTime: event.start },
    end: event.allDay ? { date: day(event.end) } : { dateTime: event.end },
    attendees: event.attendees.map((person) => ({
      ...(person.email ? { email: person.email } : {}),
      ...(person.name ? { displayName: person.name } : {}),
      self: person.me,
      resource: person.resource,
      ...(person.declined ? { responseStatus: 'declined' } : {})
    })),
    ...(event.recurring ? { recurringEventId: event.id } : {})
  }
}

/**
 * Meetings Google already reported, so the same meeting seen through a Google
 * account in macOS Calendar does not become a second task. The iCalendar UID
 * is the identity; the title at the same minute catches accounts that rewrite
 * it.
 */
export function withoutGoogleCopies(prep: PrepTask[], google: { uids: string[]; tasks: { title: string; deadline: string | null }[] }): PrepTask[] {
  const uids = new Set(google.uids)
  const minute = (iso: string | null) => (iso ? Math.floor(Date.parse(iso) / 60_000) : NaN)
  const seen = new Set(google.tasks.map((task) => `${task.title.toLowerCase()}|${minute(task.deadline)}`))
  return prep.filter((task) => !uids.has(task.sourceId) && !seen.has(`${task.title.toLowerCase()}|${minute(task.deadline)}`))
}
