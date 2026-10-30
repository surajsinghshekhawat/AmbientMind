import assert from 'node:assert/strict'
import test from 'node:test'
import {
  describePause,
  isAiPaused,
  normalizePauseAiUntil,
  pauseAiForHours
} from '../shared/pauseAi'

const NOW = Date.parse('2026-09-16T10:00:00.000Z')

test('an empty or junk value is not a pause', () => {
  assert.equal(normalizePauseAiUntil('', NOW), null)
  assert.equal(normalizePauseAiUntil('soon', NOW), null)
  assert.equal(normalizePauseAiUntil(undefined, NOW), null)
})

test('a timestamp that has already passed expires on read', () => {
  // Checked at the gate, not only at load, so a process that stays up past
  // the hour cannot remain paused by a stale config.json.
  assert.equal(normalizePauseAiUntil('2026-09-16T09:59:59.000Z', NOW), null)
  assert.equal(isAiPaused('2026-09-16T09:59:59.000Z', NOW), false)
})

test('a future timestamp is kept as UTC ISO', () => {
  const until = normalizePauseAiUntil('2026-09-16T11:00:00.000Z', NOW)
  assert.equal(until, '2026-09-16T11:00:00.000Z')
  assert.equal(isAiPaused(until, NOW), true)
})

test('pauseAiForHours is one hour ahead', () => {
  assert.equal(pauseAiForHours(1, NOW), '2026-09-16T11:00:00.000Z')
})

test('the user-facing sentence names the clock time', () => {
  assert.match(describePause('2026-09-16T11:00:00.000Z'), /paused until/)
})
