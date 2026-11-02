import assert from 'node:assert/strict'
import test from 'node:test'
import {
  addTask,
  deleteTask,
  getTask,
  reconcileCalendarTasks,
  setStatus,
  updateTask,
  type NewTask
} from '../../electron/services/taskStore'
import { freshStore } from './helpers'

const NOW = new Date('2026-11-02T08:00:00.000Z')
const hoursFromNow = (hours: number) => new Date(NOW.getTime() + hours * 3_600_000).toISOString()

function prep(sourceId: string, deadlineHours: number, title = `Prepare for ${sourceId}`): NewTask {
  return { title, deadline: hoursFromNow(deadlineHours), source: 'gcalendar', sourceId, priority: 'high' }
}

test('a rescheduled meeting moves its prep task instead of being ignored', () => {
  freshStore()
  const task = addTask(prep('evt', 2))
  const { fresh, updated } = reconcileCalendarTasks('gcalendar', [prep('evt', 6)], NOW)

  assert.deepEqual(fresh, [])
  assert.equal(updated, 1)
  assert.equal(getTask(task.id)?.deadline, hoursFromNow(6))
})

test('a title the user edited survives a reschedule', () => {
  freshStore()
  const task = addTask(prep('evt', 2))
  updateTask(task.id, { title: 'Bring the Q3 numbers' })
  reconcileCalendarTasks('gcalendar', [prep('evt', 6, 'Prepare for Renamed meeting')], NOW)

  const row = getTask(task.id)
  assert.equal(row?.title, 'Bring the Q3 numbers')
  assert.equal(row?.deadline, hoursFromNow(6))
})

test('a cancelled or vanished meeting removes its pending prep task', () => {
  freshStore()
  const cancelled = addTask(prep('cancelled', 3))
  const vanished = addTask(prep('vanished', 20))
  const kept = addTask(prep('kept', 5))
  const { removed } = reconcileCalendarTasks('gcalendar', [prep('kept', 5)], NOW)

  assert.equal(removed, 2)
  assert.equal(getTask(cancelled.id), null)
  assert.equal(getTask(vanished.id), null)
  assert.equal(getTask(kept.id)?.status, 'pending')
})

test('completed and deleted prep tasks are left as they are', () => {
  freshStore()
  const done = addTask(prep('done', 3))
  setStatus(done.id, 'done')
  const deleted = addTask(prep('deleted', 3))
  deleteTask(deleted.id)

  const { fresh } = reconcileCalendarTasks('gcalendar', [prep('done', 4), prep('deleted', 4)], NOW)
  assert.deepEqual(fresh, [])
  assert.equal(getTask(done.id)?.status, 'done')
  assert.equal(getTask(deleted.id)?.status, 'deleted')
  assert.equal(getTask(done.id)?.deadline, hoursFromNow(3))
})

test('prep for a meeting that has started is archived', () => {
  freshStore()
  const started = addTask(prep('started', -1.5))
  reconcileCalendarTasks('gcalendar', [], NOW)
  assert.equal(getTask(started.id)?.status, 'archived')
})

test('only meetings with no row yet are returned for import', () => {
  freshStore()
  addTask(prep('known', 3))
  const { fresh } = reconcileCalendarTasks('gcalendar', [prep('known', 3), prep('new', 4)], NOW)
  assert.deepEqual(fresh.map((task) => task.sourceId), ['new'])
})

test('each calendar reconciles only its own prep tasks', () => {
  freshStore()
  const google = addTask(prep('g-evt', 3))
  const apple = addTask({ ...prep('a-evt', 3), source: 'acalendar' })
  const { removed } = reconcileCalendarTasks('acalendar', [], NOW)
  assert.equal(removed, 1)
  assert.equal(getTask(apple.id), null)
  assert.equal(getTask(google.id)?.status, 'pending')
})
