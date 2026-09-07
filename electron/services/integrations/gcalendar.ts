import { googleFetch } from '../googleAuth'
import type { NewTask } from '../taskStore'

const API = 'https://www.googleapis.com/calendar/v3'

/** How far ahead of a meeting the preparation task should appear. */
const PREP_LEAD_HOURS = 1
const LOOKAHEAD_DAYS = 7

interface CalendarEvent {
  id: string
  summary?: string
  description?: string
  status?: string
  start?: { dateTime?: string; date?: string }
  end?: { dateTime?: string; date?: string }
  attendees?: { email?: string; displayName?: string; self?: boolean; responseStatus?: string }[]
  organizer?: { email?: string; displayName?: string; self?: boolean }
  eventType?: string
}

export interface CalendarSyncResult {
  tasks: NewTask[]
  nextSyncToken: string | null
}

function attendeeNames(event: CalendarEvent): string[] {
  return (event.attendees ?? [])
    .filter((a) => !a.self)
    .map((a) => a.displayName ?? a.email ?? '')
    .filter(Boolean)
    .slice(0, 5)
}

/**
 * Calendar events are structured data, so they are converted directly rather
 * than being sent through the model. Spending a generation call to turn
 * "Call with Sarah at 3pm" into a prep task would be slower and less reliable
 * than the deterministic rule.
 */
function toTask(event: CalendarEvent): NewTask | null {
  if (event.status === 'cancelled') return null
  if (event.eventType === 'workingLocation' || event.eventType === 'outOfOffice') return null

  const title = event.summary?.trim()
  if (!title) return null

  // The user having declined is a clear signal the event is not their problem.
  if (event.attendees?.some((a) => a.self && a.responseStatus === 'declined')) return null

  const people = attendeeNames(event)

  if (event.start?.date && !event.start.dateTime) {
    // All-day events are context, not commitments: surfaced quietly.
    return {
      title,
      deadline: new Date(`${event.start.date}T09:00:00`).toISOString(),
      priority: 'low',
      source: 'gcalendar',
      sourceId: event.id,
      people,
      rawContext: event.description ?? null,
      confidence: 1
    }
  }

  const startsAt = event.start?.dateTime
  if (!startsAt) return null

  const start = new Date(startsAt)
  const solo = (event.attendees?.length ?? 0) <= 1

  return {
    // A meeting with other people needs preparation; a solo block is the task.
    title: solo ? title : `Prepare for ${title}`,
    deadline: new Date(start.getTime() - PREP_LEAD_HOURS * 3_600_000).toISOString(),
    priority: 'high',
    source: 'gcalendar',
    sourceId: event.id,
    people,
    rawContext: event.description ?? null,
    confidence: 1
  }
}

/**
 * Uses Calendar's syncToken for incremental pulls. Google invalidates the token
 * with a 410 when it is too old, which is a documented signal to fall back to a
 * full resync rather than an error to report.
 */
export async function fetchUpcoming(syncToken: string | null): Promise<CalendarSyncResult> {
  const build = (token: string | null) => {
    const params = new URLSearchParams({
      singleEvents: 'true',
      maxResults: '100'
    })
    if (token) {
      params.set('syncToken', token)
    } else {
      params.set('timeMin', new Date().toISOString())
      params.set('timeMax', new Date(Date.now() + LOOKAHEAD_DAYS * 86_400_000).toISOString())
      params.set('orderBy', 'startTime')
    }
    return `${API}/calendars/primary/events?${params.toString()}`
  }

  let response = await googleFetch(build(syncToken))
  if (response.status === 410 && syncToken) {
    response = await googleFetch(build(null))
  }
  if (!response.ok) {
    throw new Error(`Calendar ${response.status}: ${(await response.text()).slice(0, 200)}`)
  }

  const data = (await response.json()) as {
    items?: CalendarEvent[]
    nextSyncToken?: string
  }

  const tasks: NewTask[] = []
  for (const event of data.items ?? []) {
    const task = toTask(event)
    if (task) tasks.push(task)
  }

  return { tasks, nextSyncToken: data.nextSyncToken ?? null }
}
