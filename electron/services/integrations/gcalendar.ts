import { PREP_LOOKAHEAD_HOURS, prepTaskFor, type CalendarEvent } from '@shared/calendarPrep'
import { googleFetch } from '../googleAuth'
import type { NewTask } from '../taskStore'

const API = 'https://www.googleapis.com/calendar/v3'

/** 250 is the API's page maximum; ten pages is far beyond two days of meetings. */
const PAGE_SIZE = 250
const MAX_PAGES = 10

/**
 * Lists the whole lookahead window on every pass rather than following a sync
 * token. A token only reports changes, so a meeting created weeks ago never
 * came back as it moved into range, and the window has to be reconciled in
 * full anyway to notice reschedules and cancellations. `showDeleted` is what
 * makes cancelled events visible here.
 */
export async function fetchPrepTasks(now = new Date()): Promise<{ tasks: NewTask[]; uids: string[] }> {
  const params = new URLSearchParams({
    singleEvents: 'true',
    showDeleted: 'true',
    orderBy: 'startTime',
    maxResults: String(PAGE_SIZE),
    timeMin: now.toISOString(),
    timeMax: new Date(now.getTime() + PREP_LOOKAHEAD_HOURS * 3_600_000).toISOString()
  })

  const events: CalendarEvent[] = []
  for (let page = 0; ; page++) {
    // A partial window would make reconciliation remove tasks for meetings
    // that simply were not listed, so running out of pages is an error.
    if (page === MAX_PAGES) throw new Error('Calendar: too many events to list')
    const response = await googleFetch(`${API}/calendars/primary/events?${params.toString()}`)
    if (!response.ok) {
      throw new Error(`Calendar ${response.status}: ${(await response.text()).slice(0, 200)}`)
    }
    const data = (await response.json()) as { items?: CalendarEvent[]; nextPageToken?: string }
    events.push(...(data.items ?? []))
    if (!data.nextPageToken) break
    params.set('pageToken', data.nextPageToken)
  }

  return {
    tasks: events.flatMap((event) => prepTaskFor(event, now) ?? []),
    // Every live event, not only the prep ones, so Apple Calendar can tell
    // which of its events are Google's.
    uids: events.flatMap((event) => (event.status !== 'cancelled' && event.iCalUID ? [event.iCalUID] : []))
  }
}
