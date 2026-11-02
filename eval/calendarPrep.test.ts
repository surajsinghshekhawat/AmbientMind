import assert from 'node:assert/strict'
import test from 'node:test'
import { fromAppleEvent, PREP_LEAD_HOURS, prepTaskFor, withoutGoogleCopies, type CalendarEvent } from '../shared/calendarPrep'
import type { AppleEvent } from '../shared/helperProtocol'

const NOW = new Date('2026-11-02T08:00:00.000Z')

function meeting(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: 'evt',
    summary: 'Design review',
    status: 'confirmed',
    start: { dateTime: '2026-11-02T15:00:00.000Z' },
    attendees: [
      { email: 'me@example.com', self: true, responseStatus: 'accepted' },
      { email: 'sam@example.com', displayName: 'Sam' }
    ],
    ...overrides
  }
}

test('a one-off meeting with other people becomes a prep task an hour before', () => {
  const task = prepTaskFor(meeting(), NOW)
  assert.ok(task)
  assert.equal(task.title, 'Prepare for Design review')
  assert.equal(task.sourceId, 'evt')
  assert.deepEqual(task.people, ['Sam'])
  assert.equal(
    new Date(task.deadline).getTime(),
    new Date('2026-11-02T15:00:00.000Z').getTime() - PREP_LEAD_HOURS * 3_600_000
  )
})

test('events that need no preparation are not imported', () => {
  const cases: [string, Partial<CalendarEvent>][] = [
    ['cancelled', { status: 'cancelled' }],
    ['declined', { attendees: [{ self: true, responseStatus: 'declined' }, { email: 'sam@example.com' }] }],
    ['solo block', { attendees: [] }],
    ['only a room', { attendees: [{ self: true }, { email: 'room@example.com', resource: true }] }],
    ['all-day', { start: { date: '2026-11-02' } }],
    ['recurring instance', { recurringEventId: 'series' }],
    ['focus time', { eventType: 'focusTime' }],
    ['out of office', { eventType: 'outOfOffice' }],
    ['working location', { eventType: 'workingLocation' }],
    ['untitled', { summary: '  ' }],
    ['already started', { start: { dateTime: '2026-11-02T07:30:00.000Z' } }],
    ['beyond the lookahead', { start: { dateTime: '2026-11-05T15:00:00.000Z' } }]
  ]
  for (const [label, overrides] of cases) {
    assert.equal(prepTaskFor(meeting(overrides), NOW), null, label)
  }
})

function appleEvent(overrides: Partial<AppleEvent> = {}): AppleEvent {
  return {
    id: 'uid-1@google.com',
    calendar: 'Work',
    account: 'Google',
    title: 'Design review',
    notes: null,
    start: '2026-11-02T15:00:00.000Z',
    end: '2026-11-02T16:00:00.000Z',
    allDay: false,
    recurring: false,
    cancelled: false,
    attendees: [
      { name: 'Me', email: 'me@example.com', me: true, declined: false, resource: false },
      { name: 'Sam', email: 'sam@example.com', me: false, declined: false, resource: false }
    ],
    ...overrides
  }
}

test('an Apple Calendar meeting follows the same rule, as its own source', () => {
  const task = prepTaskFor(fromAppleEvent(appleEvent()), NOW, 'acalendar')
  assert.ok(task)
  assert.equal(task.source, 'acalendar')
  assert.equal(task.sourceId, 'uid-1@google.com')
  assert.deepEqual(task.people, ['Sam'])
})

test('Apple events that are declined, recurring, all-day, cancelled or solo are skipped', () => {
  const me = { name: 'Me', email: 'me@example.com', me: true, declined: true, resource: false }
  const sam = { name: 'Sam', email: 'sam@example.com', me: false, declined: false, resource: false }
  for (const event of [
    appleEvent({ attendees: [me, sam] }),
    appleEvent({ recurring: true }),
    appleEvent({ allDay: true }),
    appleEvent({ cancelled: true }),
    appleEvent({ attendees: [] })
  ]) {
    assert.equal(prepTaskFor(fromAppleEvent(event), NOW, 'acalendar'), null)
  }
})

test('a meeting Google already reported is not added again from Apple Calendar', () => {
  const prep = [
    prepTaskFor(fromAppleEvent(appleEvent()), NOW, 'acalendar')!,
    prepTaskFor(fromAppleEvent(appleEvent({ id: 'other', title: 'Retro' })), NOW, 'acalendar')!,
    prepTaskFor(fromAppleEvent(appleEvent({ id: 'renamed-copy', title: 'Budget' })), NOW, 'acalendar')!
  ]
  const kept = withoutGoogleCopies(prep, {
    uids: ['uid-1@google.com'],
    tasks: [{ title: 'Prepare for Budget', deadline: prep[2]!.deadline }]
  })
  assert.deepEqual(kept.map((task) => task.title), ['Prepare for Retro'])
})
