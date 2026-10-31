import assert from 'node:assert/strict'
import test from 'node:test'
import { KEEP_TOMBSTONE_DAYS } from '../../shared/retention'
import {
  addTask,
  addTasksIgnoringDuplicates,
  deleteTask,
  forgetRecentGmail,
  getTask,
  isProcessed,
  listActive,
  markProcessed,
  purgeTombstones,
  setStatus,
  snoozeTask,
  updateTask
} from '../../electron/services/taskStore'
import { freshStore } from './helpers'

test('a deleted task leaves the list but blocks the same item from being imported again', () => {
  freshStore()
  const task = addTask({ title: 'Send the invoice', source: 'gmail', sourceId: 'm1:Send the invoice' })
  deleteTask(task.id)

  assert.deepEqual(listActive(), [])
  const again = addTasksIgnoringDuplicates([
    { title: 'Send the invoice', source: 'gmail', sourceId: 'm1:Send the invoice' }
  ])
  assert.deepEqual(again, [])
  assert.deepEqual(listActive(), [])
})

test('a deleted calendar task is not brought back when the calendar is re-read', () => {
  freshStore()
  const task = addTask({ title: 'Prepare for review', source: 'gcalendar', sourceId: 'evt-1' })
  deleteTask(task.id)
  assert.deepEqual(
    addTasksIgnoringDuplicates([{ title: 'Prepare for review', source: 'gcalendar', sourceId: 'evt-1' }]),
    []
  )
})

test('a stale window cannot complete, edit or snooze a deleted task back to life', () => {
  freshStore()
  const task = addTask({ title: 'gone' })
  deleteTask(task.id)
  setStatus(task.id, 'done')
  updateTask(task.id, { title: 'renamed' })
  snoozeTask(task.id, new Date(Date.now() + 3_600_000).toISOString())

  const row = getTask(task.id)
  assert.equal(row?.status, 'deleted')
  assert.equal(row?.title, 'gone')
})

test('tombstones are purged only after the retention window', () => {
  const db = freshStore()
  const old = addTask({ title: 'old', source: 'gmail', sourceId: 'old' })
  const recent = addTask({ title: 'recent', source: 'gmail', sourceId: 'recent' })
  deleteTask(old.id)
  deleteTask(recent.id)

  const longAgo = new Date(Date.now() - (KEEP_TOMBSTONE_DAYS + 1) * 86_400_000).toISOString()
  db.prepare(`UPDATE tasks SET deleted_at = ? WHERE id = ?`).run(longAgo, old.id)

  assert.equal(purgeTombstones(), 1)
  const left = db.prepare(`SELECT id FROM tasks`).all() as { id: string }[]
  assert.deepEqual(left.map((row) => row.id), [recent.id])
})

test('forced sync reopens only recent messages that produced no tasks', () => {
  freshStore()
  markProcessed('gmail', 'empty', 'skipped', 0)
  markProcessed('gmail', 'productive', 'extracted', 2)

  assert.equal(forgetRecentGmail(48), 1)
  assert.equal(isProcessed('gmail', 'empty'), false)
  assert.equal(isProcessed('gmail', 'productive'), true)
})
