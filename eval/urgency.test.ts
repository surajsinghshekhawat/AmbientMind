import assert from 'node:assert/strict'
import test from 'node:test'
import { isDueToday } from '../shared/urgency'
import type { Task } from '../shared/types'

const task = (deadline: Date | null): Task => ({
  id: 'x',
  title: 'x',
  deadline: deadline?.toISOString() ?? null,
  priority: 'medium',
  source: 'manual',
  sourceId: null,
  people: [],
  rawContext: null,
  confidence: 1,
  status: 'pending',
  createdAt: new Date(0).toISOString(),
  completedAt: null,
  snoozedUntil: null
})

/** Local wall-clock, so "today" means the user's day, not UTC's. */
const NOW = new Date(2026, 10, 2, 10, 0).getTime()

test('overdue and later-today tasks are due today', () => {
  assert.equal(isDueToday(task(new Date(2026, 9, 30, 9)), NOW), true)
  assert.equal(isDueToday(task(new Date(2026, 10, 2, 9)), NOW), true)
  assert.equal(isDueToday(task(new Date(2026, 10, 2, 23, 59)), NOW), true)
})

test('tomorrow and undated tasks are not', () => {
  assert.equal(isDueToday(task(new Date(2026, 10, 3, 0, 1)), NOW), false)
  assert.equal(isDueToday(task(null), NOW), false)
})
