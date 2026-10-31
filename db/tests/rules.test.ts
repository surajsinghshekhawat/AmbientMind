import assert from 'node:assert/strict'
import test from 'node:test'
import { addRule, materialiseRules, MISSED_GRACE_HOURS, updateRule } from '../../electron/services/ruleStore'
import { deleteTask, listActive, setStatus } from '../../electron/services/taskStore'
import { freshStore } from './helpers'

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6]

/** Local wall-clock time, matching how rules are evaluated. */
function at(day: number, hours: number, minutes = 0): Date {
  return new Date(2026, 10, day, hours, minutes)
}

const ruleTasks = () => listActive().filter((task) => task.source === 'rule' && task.status === 'pending')

test('a rule shows only its next occurrence, not two weeks of them', () => {
  freshStore()
  addRule({ title: 'Take vitamins', weekdays: ALL_DAYS, time: '09:00' })
  materialiseRules(at(2, 8))

  const tasks = ruleTasks()
  assert.equal(tasks.length, 1)
  assert.equal(new Date(tasks[0]!.deadline!).getTime(), at(2, 9).getTime())
})

test('completing an occurrence brings up the following one', () => {
  freshStore()
  addRule({ title: 'Take vitamins', weekdays: ALL_DAYS, time: '09:00' })
  materialiseRules(at(2, 8))
  setStatus(ruleTasks()[0]!.id, 'done')

  materialiseRules(at(2, 8, 30))
  const tasks = ruleTasks()
  assert.equal(tasks.length, 1)
  assert.equal(new Date(tasks[0]!.deadline!).getTime(), at(3, 9).getTime())
})

test('deleting an occurrence skips it for good and brings up the following one', () => {
  freshStore()
  addRule({ title: 'Tuition', weekdays: [2, 4], time: '17:00' })
  materialiseRules(at(2, 8))
  const skipped = ruleTasks()[0]!
  deleteTask(skipped.id)

  materialiseRules(at(2, 9))
  materialiseRules(at(2, 10))
  const tasks = ruleTasks()
  assert.equal(tasks.length, 1)
  assert.notEqual(tasks[0]!.sourceId, skipped.sourceId)
  assert.ok(new Date(tasks[0]!.deadline!).getTime() > new Date(skipped.deadline!).getTime())
})

test('a missed occurrence stays overdue for a while, then gives way to the next one', () => {
  freshStore()
  addRule({ title: 'Take vitamins', weekdays: ALL_DAYS, time: '09:00' })
  materialiseRules(at(2, 8))

  materialiseRules(at(2, 12))
  let tasks = ruleTasks()
  assert.equal(tasks.length, 1, 'still the missed one, not a second row')
  assert.equal(new Date(tasks[0]!.deadline!).getTime(), at(2, 9).getTime())

  materialiseRules(at(2, 9 + MISSED_GRACE_HOURS, 1))
  tasks = ruleTasks()
  assert.equal(tasks.length, 1)
  assert.equal(new Date(tasks[0]!.deadline!).getTime(), at(3, 9).getTime())
})

test('retiming a rule replaces its pending occurrence', () => {
  freshStore()
  const rule = addRule({ title: 'Stand-up', weekdays: ALL_DAYS, time: '09:00' })
  materialiseRules(at(2, 7))
  updateRule(rule.id, { weekdays: [4] })

  materialiseRules(at(2, 7, 5))
  const tasks = ruleTasks()
  assert.equal(tasks.length, 1)
  assert.equal(new Date(tasks[0]!.deadline!).getDay(), 4)
})
