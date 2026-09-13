import { strict as assert } from 'node:assert'
import test from 'node:test'
import { detectRecurrences, normaliseTitle } from '../shared/recurrenceDetect'

const NOW = new Date('2026-03-20T12:00:00')

/** Same weekday and time, `weeks` weeks running, counting back from NOW. */
function weekly(title: string, weeks: number, hour = 17, minute = 0) {
  const out = []
  for (let i = 0; i < weeks; i++) {
    const at = new Date(NOW)
    at.setDate(NOW.getDate() - i * 7)
    at.setHours(hour, minute, 0, 0)
    out.push({ title, at: at.toISOString() })
  }
  return out
}

test('three weeks of the same slot is worth asking about', () => {
  const found = detectRecurrences(weekly('Tuition', 3), { now: NOW })
  assert.equal(found.length, 1)
  assert.equal(found[0]?.title, 'Tuition')
  assert.deepEqual(found[0]?.weekdays, [NOW.getDay()])
  assert.equal(found[0]?.time, '17:00')
  assert.equal(found[0]?.occurrences, 3)
})

test('two weeks is not enough', () => {
  assert.equal(detectRecurrences(weekly('Tuition', 2), { now: NOW }).length, 0)
})

test('three hits in one week is not a weekly pattern', () => {
  const sameWeek = [0, 1, 2].map((i) => {
    const at = new Date(NOW)
    at.setDate(NOW.getDate() - i)
    at.setHours(17, 0, 0, 0)
    return { title: 'Standup', at: at.toISOString() }
  })
  assert.equal(detectRecurrences(sameWeek, { now: NOW }).length, 0)
})

test('same weekday at scattered times is a coincidence', () => {
  const scattered = [
    ...weekly('Errand', 1, 9),
    ...weekly('Errand', 1, 14).map((t) => ({
      ...t,
      at: new Date(new Date(t.at).getTime() - 7 * 86_400_000).toISOString()
    })),
    ...weekly('Errand', 1, 20).map((t) => ({
      ...t,
      at: new Date(new Date(t.at).getTime() - 14 * 86_400_000).toISOString()
    }))
  ]
  assert.equal(detectRecurrences(scattered, { now: NOW }).length, 0)
})

test('small time drift still counts as the same routine', () => {
  const drifting = [
    ...weekly('Gym', 1, 7, 0),
    ...weekly('Gym', 1, 7, 20).map((t) => ({
      ...t,
      at: new Date(new Date(t.at).getTime() - 7 * 86_400_000).toISOString()
    })),
    ...weekly('Gym', 1, 6, 50).map((t) => ({
      ...t,
      at: new Date(new Date(t.at).getTime() - 14 * 86_400_000).toISOString()
    }))
  ]
  const found = detectRecurrences(drifting, { now: NOW })
  assert.equal(found.length, 1)
  assert.equal(found[0]?.time, '07:00')
})

test('anything older than the window is ignored', () => {
  const stale = weekly('Old habit', 3).map((t) => ({
    ...t,
    at: new Date(new Date(t.at).getTime() - 200 * 86_400_000).toISOString()
  }))
  assert.equal(detectRecurrences(stale, { now: NOW }).length, 0)
})

test('titles are matched after normalisation', () => {
  assert.equal(normaliseTitle('  Tuition!!  class '), 'tuition class')
  const mixed = [
    ...weekly('Tuition', 1),
    ...weekly('tuition!', 1).map((t) => ({
      ...t,
      at: new Date(new Date(t.at).getTime() - 7 * 86_400_000).toISOString()
    })),
    ...weekly('TUITION', 1).map((t) => ({
      ...t,
      at: new Date(new Date(t.at).getTime() - 14 * 86_400_000).toISOString()
    }))
  ]
  assert.equal(detectRecurrences(mixed, { now: NOW }).length, 1)
})

test('signature is stable so a dismissal can stick', () => {
  const a = detectRecurrences(weekly('Tuition', 3), { now: NOW })[0]?.signature
  const b = detectRecurrences(weekly('Tuition', 4), { now: NOW })[0]?.signature
  assert.equal(a, b)
})
