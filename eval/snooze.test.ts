import { strict as assert } from 'node:assert'
import test from 'node:test'
import { SNOOZE_CHOICES } from '../shared/snooze'

function choice(id: string) {
  const found = SNOOZE_CHOICES.find((c) => c.id === id)
  assert.ok(found, `no snooze choice "${id}"`)
  return found
}

test('relative snoozes are offsets from now', () => {
  const now = new Date('2026-03-10T14:20:00')
  assert.equal(choice('1h').resolve(now).getTime() - now.getTime(), 3_600_000)
  assert.equal(choice('3h').resolve(now).getTime() - now.getTime(), 3 * 3_600_000)
})

test('tomorrow 9am lands on the next day at 09:00 local', () => {
  const result = choice('tomorrow').resolve(new Date('2026-03-10T23:45:00'))
  assert.equal(result.getDate(), 11)
  assert.equal(result.getHours(), 9)
  assert.equal(result.getMinutes(), 0)
})

test('"this evening" before 18:00 stays on the same day', () => {
  const result = choice('tonight').resolve(new Date('2026-03-10T09:00:00'))
  assert.equal(result.getDate(), 10)
  assert.equal(result.getHours(), 18)
})

test('"this evening" after 18:00 rolls forward rather than waking instantly', () => {
  const now = new Date('2026-03-10T21:30:00')
  const result = choice('tonight').resolve(now)
  assert.ok(result.getTime() > now.getTime(), 'snooze must be in the future')
  assert.equal(result.getDate(), 11)
})

test('every choice resolves to a future time', () => {
  const now = new Date('2026-03-10T18:00:00')
  for (const option of SNOOZE_CHOICES) {
    assert.ok(
      option.resolve(now).getTime() > now.getTime(),
      `${option.id} resolved to the past`
    )
  }
})
