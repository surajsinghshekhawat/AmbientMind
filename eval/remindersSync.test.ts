import assert from 'node:assert/strict'
import test from 'node:test'
import type { AppleReminder } from '../shared/helperProtocol'
import {
  fromReminderPriority,
  planReminderSync,
  reminderFields,
  taskFields,
  toReminderPriority,
  type ReminderLink,
  type SyncTask
} from '../shared/remindersSync'

const T0 = '2026-11-02T08:00:00.000Z'
const T1 = '2026-11-02T09:00:00.000Z'
const T2 = '2026-11-02T10:00:00.000Z'

function task(over: Partial<SyncTask> = {}): SyncTask {
  return {
    id: 't1',
    title: 'Send the invoice',
    deadline: null,
    priority: 'medium',
    status: 'pending',
    evidence: null,
    sourceUrl: null,
    updatedAt: T0,
    deletedAt: null,
    ...over
  }
}

function reminder(over: Partial<AppleReminder> = {}): AppleReminder {
  return {
    id: 'r1',
    title: 'Send the invoice',
    notes: null,
    due: null,
    dueAllDay: false,
    priority: 0,
    completed: false,
    completedAt: null,
    modifiedAt: T0,
    recurring: false,
    ...over
  }
}

function link(t: SyncTask, r: AppleReminder): ReminderLink {
  return { taskId: t.id, externalId: r.id, modifiedAt: r.modifiedAt, local: taskFields(t), remote: reminderFields(r) }
}

test('an open task with no reminder is offered to Reminders, with its evidence as notes', () => {
  const ops = planReminderSync({ tasks: [task({ evidence: 'Can you send it by Friday?' })], links: [], reminders: [] })
  assert.equal(ops.length, 1)
  assert.equal(ops[0]?.kind, 'create-remote')
  if (ops[0]?.kind === 'create-remote') {
    assert.equal(ops[0].write.title, 'Send the invoice')
    assert.equal(ops[0].write.notes, 'Can you send it by Friday?')
    assert.equal(ops[0].write.completed, false)
  }
})

test('done, suggested and deleted tasks are not pushed for the first time', () => {
  const tasks = [task({ id: 'a', status: 'done' }), task({ id: 'b', status: 'suggested' }), task({ id: 'c', status: 'deleted' })]
  assert.deepEqual(planReminderSync({ tasks, links: [], reminders: [] }), [])
})

test('a new reminder from the iPhone becomes a task; completed history does not', () => {
  const ops = planReminderSync({ tasks: [], links: [], reminders: [reminder(), reminder({ id: 'r2', completed: true })] })
  assert.deepEqual(
    ops.map((op) => op.kind),
    ['create-local']
  )
})

test('nothing to do when neither side changed', () => {
  const t = task()
  const r = reminder()
  assert.deepEqual(planReminderSync({ tasks: [t], links: [link(t, r)], reminders: [r] }), [])
})

test('completing on the iPhone completes the task here', () => {
  const t = task()
  const before = reminder()
  const after = reminder({ completed: true, completedAt: T1, modifiedAt: T1 })
  const [op] = planReminderSync({ tasks: [t], links: [link(t, before)], reminders: [after] })
  assert.equal(op?.kind, 'merge')
  if (op?.kind === 'merge') {
    assert.deepEqual(op.patch, { done: true })
    assert.deepEqual(op.write, {})
  }
})

test('completing here completes the reminder, naming the version it read', () => {
  const t = task()
  const r = reminder()
  const l = link(t, r)
  const [op] = planReminderSync({ tasks: [{ ...t, status: 'done', updatedAt: T1 }], links: [l], reminders: [r] })
  assert.equal(op?.kind, 'merge')
  if (op?.kind === 'merge') {
    assert.deepEqual(op.write, { completed: true })
    assert.deepEqual(op.patch, {})
  }
})

test('different fields changed on each side are both kept', () => {
  const t = task()
  const r = reminder()
  const l = link(t, r)
  const [op] = planReminderSync({
    tasks: [{ ...t, title: 'Send the final invoice', updatedAt: T1 }],
    links: [l],
    reminders: [{ ...r, priority: 1, modifiedAt: T2 }]
  })
  assert.equal(op?.kind, 'merge')
  if (op?.kind === 'merge') {
    assert.deepEqual(op.write, { title: 'Send the final invoice' })
    assert.deepEqual(op.patch, { priority: 'high' })
  }
})

test('the same field changed on both sides goes to the later edit', () => {
  const t = task()
  const r = reminder()
  const l = link(t, r)
  const remoteLater = planReminderSync({
    tasks: [{ ...t, title: 'Here', updatedAt: T1 }],
    links: [l],
    reminders: [{ ...r, title: 'There', modifiedAt: T2 }]
  })[0]
  assert.ok(remoteLater?.kind === 'merge' && remoteLater.patch.title === 'There' && !remoteLater.write.title)

  const localLater = planReminderSync({
    tasks: [{ ...t, title: 'Here', updatedAt: T2 }],
    links: [l],
    reminders: [{ ...r, title: 'There', modifiedAt: T1 }]
  })[0]
  assert.ok(localLater?.kind === 'merge' && localLater.write.title === 'Here' && !localLater.patch.title)
})

test('a lossy priority round trip does not ping-pong', () => {
  const t = task({ priority: 'urgent' })
  const r = reminder({ priority: toReminderPriority('urgent') })
  assert.equal(fromReminderPriority(r.priority), 'high')
  assert.deepEqual(planReminderSync({ tasks: [t], links: [link(t, r)], reminders: [r] }), [])
})

test('a date-only reminder is due at the end of the working day', () => {
  const fields = reminderFields(reminder({ due: new Date(2026, 10, 6).toISOString(), dueAllDay: true }))
  const due = new Date(fields.deadline!)
  assert.equal(due.getDate(), 6)
  assert.equal(due.getHours(), 17)
})

test('deleted here: the reminder goes, unless it was edited there afterwards', () => {
  const t = task()
  const r = reminder()
  const l = link(t, r)
  const deleted = { ...t, status: 'deleted' as const, deletedAt: T1, updatedAt: T1 }
  assert.equal(planReminderSync({ tasks: [deleted], links: [l], reminders: [r] })[0]?.kind, 'delete-remote')
  const editedLater = { ...r, title: 'Still needed', modifiedAt: T2 }
  assert.equal(planReminderSync({ tasks: [deleted], links: [l], reminders: [editedLater] })[0]?.kind, 'restore-local')
})

test('a prep task removed with its meeting takes its reminder with it', () => {
  const t = task()
  const r = reminder()
  const [op] = planReminderSync({ tasks: [], links: [link(t, r)], reminders: [r] })
  assert.ok(op?.kind === 'delete-remote' && op.force)
})

test('deleted on the iPhone: the open task goes; a finished one just lets go', () => {
  const open = task({ id: 'open' })
  const done = task({ id: 'done', status: 'done' })
  const ops = planReminderSync({
    tasks: [open, done],
    links: [link(open, reminder({ id: 'r-open' })), link(done, reminder({ id: 'r-done' }))],
    reminders: []
  })
  assert.deepEqual(ops.map((op) => `${op.kind}:${'link' in op ? op.link.taskId : ''}`).sort(), ['delete-local:open', 'unlink:done'])
})

test('a whole list vanishing at once deletes nothing here', () => {
  const tasks = Array.from({ length: 8 }, (_, i) => task({ id: `t${i}` }))
  const links = tasks.map((t, i) => link(t, reminder({ id: `r${i}` })))
  const ops = planReminderSync({ tasks, links, reminders: [] })
  assert.ok(ops.every((op) => op.kind === 'unlink'))
})
