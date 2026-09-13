import { ruleToEvent } from '@shared/calendarEvent'
import type { RecurrenceRule } from '@shared/recurrence'
import { googleFetch, hasCalendarWriteScope } from '../googleAuth'

const API = 'https://www.googleapis.com/calendar/v3'

/**
 * Rules are written to a calendar this app creates, never to the user's own.
 *
 * A separate calendar can be hidden or deleted in one tap on the phone, keeps
 * generated entries from being mistaken for ones the user made, and pairs with
 * the `calendar.app.created` scope so a bug here *cannot* reach a real
 * calendar. Writing into "primary" would have been fewer lines and no way back.
 */
const CALENDAR_SUMMARY = 'AmbientMind'

let calendarIdCache: string | null = null

export class CalendarScopeError extends Error {
  constructor() {
    super('Reconnect your Google account to allow AmbientMind to write to a calendar')
    this.name = 'CalendarScopeError'
  }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await googleFetch(`${API}${path}`, init)
  if (!response.ok) {
    throw new Error(`Calendar ${response.status}: ${(await response.text()).slice(0, 200)}`)
  }
  return (await response.json()) as T
}

/** Finds the app's calendar, creating it on first use. */
async function calendarId(): Promise<string> {
  if (calendarIdCache) return calendarIdCache
  if (!hasCalendarWriteScope()) throw new CalendarScopeError()

  const list = await call<{ items?: { id: string; summary?: string }[] }>(
    '/users/me/calendarList?minAccessRole=owner'
  )
  const existing = list.items?.find((entry) => entry.summary === CALENDAR_SUMMARY)
  if (existing) {
    calendarIdCache = existing.id
    return existing.id
  }

  const created = await call<{ id: string }>('/calendars', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      summary: CALENDAR_SUMMARY,
      description: 'Recurring commitments from AmbientMind. Safe to hide or delete.',
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
    })
  })
  calendarIdCache = created.id
  return created.id
}

/**
 * Creates or updates the event for a rule and returns its event id.
 * A paused rule is removed from the calendar rather than left behind, because
 * an event still showing on a phone is exactly the thing pausing was meant to
 * stop.
 */
export async function pushRule(
  rule: RecurrenceRule,
  existingEventId: string | null
): Promise<string | null> {
  if (!rule.enabled) {
    await removeRule(existingEventId)
    return null
  }

  const body = ruleToEvent(rule, {
    from: new Date(),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
  })
  if (!body) return existingEventId

  const id = await calendarId()
  const init = {
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  }

  if (existingEventId) {
    try {
      await call(`/calendars/${encodeURIComponent(id)}/events/${existingEventId}`, {
        ...init,
        method: 'PUT'
      })
      return existingEventId
    } catch {
      // Deleted on the phone, or the calendar was recreated. Fall through and
      // make a new one rather than losing the rule from the calendar for good.
    }
  }

  const created = await call<{ id: string }>(`/calendars/${encodeURIComponent(id)}/events`, {
    ...init,
    method: 'POST'
  })
  return created.id
}

export async function removeRule(eventId: string | null): Promise<void> {
  if (!eventId || !hasCalendarWriteScope()) return
  const id = await calendarId()
  // Already gone is the desired state, so a 404 is not worth reporting.
  await googleFetch(`${API}/calendars/${encodeURIComponent(id)}/events/${eventId}`, {
    method: 'DELETE'
  }).catch(() => undefined)
}
