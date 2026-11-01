import assert from 'node:assert/strict'
import test from 'node:test'
import { needsEnrichment, parseCapture } from '../shared/capture'

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
  assert.equal(parsed.title, 'Stand-up notes')
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

test('Quick Add asks the model only when there is something left to find', () => {
  const skip = (text: string) => needsEnrichment(parseCapture(text, NOW))
  assert.equal(skip('Buy milk'), false)
  assert.equal(skip('Call mum tomorrow at 5pm'), false)
  assert.equal(skip('Send the deck to Priya urgent'), false)
  assert.equal(skip('Send the deck before the board meeting'), true)
  assert.equal(skip('Renew passport next month'), true)
  assert.equal(skip('dentist friday morning'), false)
  assert.equal(skip('dentist in two weeks'), false)
  assert.equal(skip('dentist before the holidays'), true)
  assert.equal(skip('remember that I need to sort out the thing with the landlord about the deposit and the boiler'), true)
  assert.equal(skip('tuition Tue, Thu, Sat at 5pm'), false)
})

test('titles start with a capital letter', () => {
  assert.equal(parseCapture('buy milk', NOW).title, 'Buy milk')
})

test('end of day, week and month are deadlines', () => {
  const day = parseCapture('send the deck by end of day', NOW)
  assert.equal(day.title, 'Send the deck')
  assert.equal(new Date(day.deadline!).getDate(), 2)

  // NOW is a Monday; the week ends that Friday.
  const week = parseCapture('headcount plan by end of week', NOW)
  assert.equal(week.title, 'Headcount plan')
  assert.equal(new Date(week.deadline!).getDay(), 5)
  assert.equal(new Date(week.deadline!).getDate(), 6)

  const month = parseCapture('close the books by the end of the month', NOW)
  assert.equal(month.title, 'Close the books')
  assert.equal(new Date(month.deadline!).getDate(), 30)
})

test('morning, afternoon and evening set the hour; a greeting does not', () => {
  const morning = parseCapture('call mum tomorrow morning', NOW)
  assert.equal(morning.title, 'Call mum')
  assert.equal(new Date(morning.deadline!).getDate(), 3)
  assert.equal(new Date(morning.deadline!).getHours(), 9)

  const afternoon = parseCapture('review the deck this afternoon', NOW)
  assert.equal(afternoon.title, 'Review the deck')
  assert.equal(new Date(afternoon.deadline!).getDate(), 2)
  assert.equal(new Date(afternoon.deadline!).getHours(), 15)

  assert.equal(parseCapture('good morning team', NOW).deadline, null)
})

test('times counted from now', () => {
  const hour = parseCapture('remind me to shower today in a hour', NOW)
  assert.equal(hour.title, 'Shower')
  assert.equal(hour.deadline, new Date(2026, 10, 2, 13, 0).toISOString())

  assert.equal(parseCapture('stretch in 20 minutes', NOW).deadline, new Date(2026, 10, 2, 12, 20).toISOString())
  assert.equal(parseCapture('tea in half an hour', NOW).deadline, new Date(2026, 10, 2, 12, 30).toISOString())

  const days = parseCapture('renew the parking permit in two days', NOW)
  assert.equal(days.title, 'Renew the parking permit')
  assert.equal(days.deadline, new Date(2026, 10, 4, 17, 0).toISOString())

  // NOW is a Monday; next week starts the following Monday.
  assert.equal(parseCapture('plan the offsite next week', NOW).deadline, new Date(2026, 10, 9, 9, 0).toISOString())
})
