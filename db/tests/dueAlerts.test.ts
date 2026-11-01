import assert from 'node:assert/strict'
import test from 'node:test'
import { addTask, deleteTask, markAlerted, remindAgainAt, setStatus, snoozeTask, tasksToAlert, updateTask, wakeSnoozed } from '../../electron/services/taskStore'
import { freshStore } from './helpers'

const NOW = Date.now()
const at = (minutes: number) => new Date(NOW + minutes * 60_000).toISOString()

test('a task due soon is alerted once, and again after its deadline moves', () => {
  freshStore()
  const soon = addTask({ title: 'Call the bank', deadline: at(10) })
  addTask({ title: 'Later', deadline: at(120) })
  addTask({ title: 'No deadline' })
  const done = addTask({ title: 'Already done', deadline: at(5) })
  setStatus(done.id, 'done')
  deleteTask(addTask({ title: 'Deleted', deadline: at(5) }).id)

  assert.deepEqual(tasksToAlert(NOW, 15).map((task) => task.title), ['Call the bank'])
  markAlerted(soon.id)
  assert.deepEqual(tasksToAlert(NOW, 15), [])

  updateTask(soon.id, { deadline: at(12) })
  assert.deepEqual(tasksToAlert(NOW, 15).map((task) => task.title), ['Call the bank'])
})

test('snooze from an alert hides the task and alerts again when it wakes', () => {
  freshStore()
  const task = addTask({ title: 'Send the invoice', deadline: at(5) })
  markAlerted(task.id)
  snoozeTask(task.id, at(60))
  remindAgainAt(task.id, at(60))

  assert.deepEqual(tasksToAlert(NOW + 61 * 60_000, 15), [], 'still snoozed until the sweep wakes it')
  wakeSnoozed(NOW + 61 * 60_000)
  assert.deepEqual(tasksToAlert(NOW + 61 * 60_000, 15).map((t) => t.title), ['Send the invoice'])
})
