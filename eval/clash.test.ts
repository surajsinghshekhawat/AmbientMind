import { strict as assert } from 'node:assert'
import test from 'node:test'
import { findClashes } from '../shared/clash'
import type { Task, TaskPriority, TaskSource } from '../shared/types'

const NOW = Date.parse('2026-03-10T09:00:00')

function task(
  id: string,
  title: string,
  deadlineIso: string,
  extra: Partial<Pick<Task, 'priority' | 'source' | 'createdAt' | 'status'>> = {}
): Task {
  return {
    id,
    title,
    deadline: deadlineIso,
    priority: (extra.priority ?? 'medium') as TaskPriority,
    source: (extra.source ?? 'manual') as TaskSource,
    sourceId: null,
    people: [],
    rawContext: null,
    confidence: 1,
    status: extra.status ?? 'pending',
    createdAt: extra.createdAt ?? '2026-03-01T09:00:00.000Z',
    completedAt: null,
    snoozedUntil: null
  }
}

test('tasks an hour apart do not clash', () => {
  const clashes = findClashes(
    [
      task('a', 'Tuition', '2026-03-10T17:00:00'),
      task('b', 'Report', '2026-03-10T19:00:00')
    ],
    { now: NOW }
  )
  assert.equal(clashes.length, 0)
})

test('the earlier deadline goes first when they are clearly apart', () => {
  const clashes = findClashes(
    [
      task('a', 'Tuition', '2026-03-10T17:30:00'),
      task('b', 'Report', '2026-03-10T17:00:00')
    ],
    { now: NOW }
  )
  assert.equal(clashes.length, 1)
  assert.equal(clashes[0]?.reason, 'earlier-deadline')
  assert.equal(clashes[0]?.order[0]?.title, 'Report')
  assert.match(clashes[0]!.explanation, /due sooner/)
})

test('at the same moment, priority decides', () => {
  const clashes = findClashes(
    [
      task('a', 'Tuition', '2026-03-10T17:00:00'),
      task('b', 'Pay fees', '2026-03-10T17:05:00', { priority: 'urgent' })
    ],
    { now: NOW }
  )
  assert.equal(clashes[0]?.reason, 'higher-priority')
  assert.equal(clashes[0]?.order[0]?.title, 'Pay fees')
})

test('a standing commitment wins a genuine tie', () => {
  const clashes = findClashes(
    [
      task('a', 'Tuition', '2026-03-10T17:00:00', { source: 'rule' }),
      task('b', 'Call Sam', '2026-03-10T17:05:00')
    ],
    { now: NOW }
  )
  assert.equal(clashes[0]?.reason, 'standing-commitment')
  assert.equal(clashes[0]?.order[0]?.title, 'Tuition')
  assert.match(clashes[0]!.explanation, /standing commitment/)
})

test('the verdict is identical whatever order the tasks arrive in', () => {
  const a = task('a', 'Tuition', '2026-03-10T17:00:00', { source: 'rule' })
  const b = task('b', 'Call Sam', '2026-03-10T17:05:00')

  const forward = findClashes([a, b], { now: NOW })[0]
  const backward = findClashes([b, a], { now: NOW })[0]

  assert.equal(forward?.explanation, backward?.explanation)
  assert.equal(forward?.order[0]?.id, backward?.order[0]?.id)
})

test('completed, undated and far-off tasks are ignored', () => {
  const clashes = findClashes(
    [
      task('a', 'Done thing', '2026-03-10T17:00:00', { status: 'done' }),
      task('b', 'Other', '2026-03-10T17:05:00'),
      task('c', 'Next month', '2026-04-10T17:00:00'),
      task('d', 'Also next month', '2026-04-10T17:05:00')
    ],
    { now: NOW }
  )
  assert.equal(clashes.length, 0)
})

test('a past deadline is not a clash to plan around', () => {
  const clashes = findClashes(
    [
      task('a', 'Overdue', '2026-03-10T07:00:00'),
      task('b', 'Also overdue', '2026-03-10T07:05:00')
    ],
    { now: NOW }
  )
  assert.equal(clashes.length, 0)
})

test('a three-way pile-up is reported as pairs, never double-counting a task', () => {
  const clashes = findClashes(
    [
      task('a', 'One', '2026-03-10T17:00:00'),
      task('b', 'Two', '2026-03-10T17:10:00'),
      task('c', 'Three', '2026-03-10T17:20:00')
    ],
    { now: NOW }
  )
  const ids = clashes.flatMap((clash) => clash.order.map((t) => t.id))
  assert.equal(new Set(ids).size, ids.length, 'no task may appear in two clashes')
})
