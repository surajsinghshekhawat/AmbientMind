import { strict as assert } from 'node:assert'
import test from 'node:test'
import {
  describeRule,
  occurrenceKey,
  occurrencesWithin,
  parseRecurrence
} from '../shared/recurrence'

test('parses the tuition phrasing from the product ask', () => {
  const parsed = parseRecurrence('remind me for tuition Tue, Thu, Sat at 5pm')
  assert.ok(parsed)
  assert.equal(parsed.title.toLowerCase(), 'tuition')
  assert.deepEqual(parsed.weekdays, [2, 4, 6])
  assert.equal(parsed.time, '17:00')
})

test('a single weekday needs an explicit marker to count as recurring', () => {
  // One-off: a meeting this Tuesday must not become weekly forever.
  assert.equal(parseRecurrence('meeting tuesday at 5pm'), null)

  const parsed = parseRecurrence('gym every tuesday at 7am')
  assert.ok(parsed)
  assert.deepEqual(parsed.weekdays, [2])
  assert.equal(parsed.time, '07:00')
})

test('handles daily, weekdays and weekends', () => {
  assert.deepEqual(parseRecurrence('standup every day at 9:30')?.weekdays, [0, 1, 2, 3, 4, 5, 6])
  assert.deepEqual(parseRecurrence('gym on weekdays at 7am')?.weekdays, [1, 2, 3, 4, 5])
  assert.deepEqual(parseRecurrence('call home weekends at 11am')?.weekdays, [0, 6])
})

test('abbreviations do not collide', () => {
  const parsed = parseRecurrence('class every mon, wed, thurs at 10:15')
  assert.ok(parsed)
  assert.deepEqual(parsed.weekdays, [1, 3, 4])
  assert.equal(parsed.time, '10:15')
})

test('12-hour and 24-hour times both resolve', () => {
  assert.equal(parseRecurrence('x every monday at 12am')?.time, '00:00')
  assert.equal(parseRecurrence('x every monday at 12pm')?.time, '12:00')
  assert.equal(parseRecurrence('x every monday at 17:45')?.time, '17:45')
})

test('named times stand in for a clock time', () => {
  const morning = parseRecurrence('take medicine every morning')
  assert.ok(morning)
  assert.equal(morning.time, '09:00')
  assert.deepEqual(morning.weekdays, [0, 1, 2, 3, 4, 5, 6])
  assert.equal(morning.title.toLowerCase(), 'take medicine')

  assert.equal(parseRecurrence('call home every evening')?.time, '19:00')
  assert.equal(parseRecurrence('journal every night')?.time, '21:00')
})

test('a named day is not overridden by a named time', () => {
  // "every Tuesday evening" is one weekday, not all seven.
  const parsed = parseRecurrence('tuition every tuesday evening')
  assert.ok(parsed)
  assert.deepEqual(parsed.weekdays, [2])
  assert.equal(parsed.time, '19:00')
  assert.equal(parsed.title.toLowerCase(), 'tuition')
})

test('a stated clock time beats the named one', () => {
  const parsed = parseRecurrence('tuition tue, thu evening at 5pm')
  assert.ok(parsed)
  assert.equal(parsed.time, '17:00')
  assert.deepEqual(parsed.weekdays, [2, 4])
  assert.equal(parsed.title.toLowerCase(), 'tuition')
})

test('text with no time is not a recurrence', () => {
  assert.equal(parseRecurrence('tuition every tuesday and thursday'), null)
  assert.equal(parseRecurrence('buy milk'), null)
})

test('occurrences are in the future and land on the requested weekdays', () => {
  // A Tuesday at 09:00 local.
  const from = new Date('2026-03-10T09:00:00')
  const dates = occurrencesWithin({ weekdays: [2, 4], time: '17:00' }, from, 14)

  assert.ok(dates.length >= 4)
  for (const date of dates) {
    assert.ok(date.getTime() > from.getTime(), 'occurrence must be in the future')
    assert.ok([2, 4].includes(date.getDay()))
    assert.equal(date.getHours(), 17)
    assert.equal(date.getMinutes(), 0)
  }
  // Today still counts when the time has not passed yet.
  assert.equal(dates[0]?.getDate(), 10)
})

test('an occurrence already past today is skipped', () => {
  const from = new Date('2026-03-10T18:30:00')
  const dates = occurrencesWithin({ weekdays: [2], time: '17:00' }, from, 14)
  assert.notEqual(dates[0]?.getDate(), 10)
})

test('occurrence keys are stable per rule and day', () => {
  const at = new Date('2026-03-10T17:00:00')
  assert.equal(occurrenceKey('rule-1', at), 'rule-1:2026-03-10')
  assert.equal(occurrenceKey('rule-1', at), occurrenceKey('rule-1', new Date(at)))
})

test('describes rules the way a person would read them', () => {
  assert.equal(describeRule({ weekdays: [2, 4, 6], time: '17:00' }), 'Tue, Thu, Sat at 17:00')
  assert.equal(describeRule({ weekdays: [1, 2, 3, 4, 5], time: '09:00' }), 'Weekdays at 09:00')
  assert.equal(
    describeRule({ weekdays: [0, 1, 2, 3, 4, 5, 6], time: '08:00' }),
    'Every day at 08:00'
  )
})
