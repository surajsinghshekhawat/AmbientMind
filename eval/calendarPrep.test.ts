import assert from 'node:assert/strict'
import test from 'node:test'
import { PREP_LEAD_HOURS, prepTaskFor, type CalendarEvent } from '../shared/calendarPrep'

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
