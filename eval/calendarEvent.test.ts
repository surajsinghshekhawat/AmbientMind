import assert from 'node:assert/strict'
import test from 'node:test'
import { ruleToEvent } from '../shared/calendarEvent'

// A Sunday, so "next Tuesday" is unambiguous in the assertions below.
const FROM = new Date('2026-09-13T10:00:00')

const TUITION = { title: 'Tuition', weekdays: [2, 4, 6], time: '17:00' }

test('weekdays become an RRULE Google understands', () => {
  const event = ruleToEvent(TUITION, { from: FROM, timeZone: 'Asia/Kolkata' })
  assert.ok(event)
  assert.deepEqual(event.recurrence, ['RRULE:FREQ=WEEKLY;BYDAY=TU,TH,SA'])
})

test('the first instance lands on a day the rule actually falls on', () => {
  const event = ruleToEvent(TUITION, { from: FROM, timeZone: 'Asia/Kolkata' })
  assert.ok(event)
  // Tuesday the 15th, not the Sunday we started from.
  assert.equal(event.start.dateTime, '2026-09-15T17:00:00')
})

test('times are sent as local wall-clock with a zone, never as an instant', () => {
  // This is what keeps "tuition at five" at five across DST and travel.
  const event = ruleToEvent(TUITION, { from: FROM, timeZone: 'Asia/Kolkata' })
  assert.ok(event)
  assert.equal(event.start.timeZone, 'Asia/Kolkata')
  assert.ok(!event.start.dateTime.endsWith('Z'), 'must not be a UTC instant')
})

test('an event has a duration so it reads as a block', () => {
  const event = ruleToEvent(TUITION, { from: FROM, timeZone: 'Asia/Kolkata' })
  assert.ok(event)
  assert.equal(event.end.dateTime, '2026-09-15T17:30:00')
})

test('every day maps to all seven BYDAY codes', () => {
  const event = ruleToEvent(
    { title: 'Medicine', weekdays: [0, 1, 2, 3, 4, 5, 6], time: '09:00' },
    { from: FROM, timeZone: 'Asia/Kolkata' }
  )
  assert.ok(event)
  assert.deepEqual(event.recurrence, ['RRULE:FREQ=WEEKLY;BYDAY=SU,MO,TU,WE,TH,FR,SA'])
})

test('a rule with no weekdays produces no event', () => {
  assert.equal(
    ruleToEvent({ title: 'Nothing', weekdays: [], time: '09:00' }, {
      from: FROM,
      timeZone: 'Asia/Kolkata'
    }),
    null
  )
})
