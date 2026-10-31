import assert from 'node:assert/strict'
import test from 'node:test'
import { parseCapture } from '../shared/capture'

/** Monday 2 November 2026, 12:00 local. */
const NOW = new Date(2026, 10, 2, 12, 0, 0)

function local(iso: string | null) {
  assert.ok(iso)
  const d = new Date(iso)
  return { day: d.getDate(), hour: d.getHours(), minute: d.getMinutes() }
}

test('plain text stays a plain task', () => {
  const parsed = parseCapture('Buy milk', NOW)
  assert.equal(parsed.title, 'Buy milk')
  assert.equal(parsed.deadline, null)
  assert.equal(parsed.priority, null)
  assert.deepEqual(parsed.people, [])
  assert.equal(parsed.recurrence, null)
})

test('a day and a time become the deadline and leave the title', () => {
  const parsed = parseCapture('Call mum tomorrow at 5pm', NOW)
  assert.equal(parsed.title, 'Call mum')
  assert.deepEqual(local(parsed.deadline), { day: 3, hour: 17, minute: 0 })
  assert.match(parsed.deadlineLabel ?? '', /^Tomorrow, /)
})

test('a day alone means the end of that working day', () => {
  const parsed = parseCapture('Send the invoice by Friday', NOW)
  assert.equal(parsed.title, 'Send the invoice')
  assert.deepEqual(local(parsed.deadline), { day: 6, hour: 17, minute: 0 })
})

test('a time already past today rolls to tomorrow', () => {
  const parsed = parseCapture('stand-up notes at 9:30am', NOW)
  assert.deepEqual(local(parsed.deadline), { day: 3, hour: 9, minute: 30 })
  assert.equal(parsed.title, 'stand-up notes')
})

test('naming today\'s weekday means next week', () => {
  const monday = new Date(2026, 10, 2, 9, 0, 0)
  assert.equal(monday.getDay(), 1)
  assert.equal(local(parseCapture('Review on monday', monday).deadline).day, 9)
})

test('urgency cues set priority; @names and "with Name" set people', () => {
  const parsed = parseCapture('Reply to @Priya about the contract asap', NOW)
  assert.equal(parsed.priority, 'urgent')
  assert.deepEqual(parsed.people, ['Priya'])
  assert.equal(parsed.title, 'Reply to Priya about the contract')
  assert.deepEqual(parseCapture('Lunch with Sam on thursday', NOW).people, ['Sam'])
  assert.equal(parseCapture('Pay rent!', NOW).priority, 'urgent')
  assert.equal(parseCapture('Pay rent!', NOW).title, 'Pay rent')
})

test('recurrence needs an explicit cue and wins over a one-off deadline', () => {
  const parsed = parseCapture('gym every monday and wednesday at 7am', NOW)
  assert.ok(parsed.recurrence)
  assert.deepEqual(parsed.recurrence.weekdays, [1, 3])
  assert.equal(parsed.deadline, null)
  assert.equal(parseCapture('gym monday at 7am', NOW).recurrence, null)
})

test('the screen phrase is flagged', () => {
  assert.equal(parseCapture("add what's on my screen", NOW).screen, true)
  assert.equal(parseCapture('screen the candidates', NOW).screen, false)
})
