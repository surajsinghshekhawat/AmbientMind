import assert from 'node:assert/strict'
import test from 'node:test'
import { HelperError, type AppleReminder, type ReminderWrite } from '../../shared/helperProtocol'
import { countReminderLinks, listReminderLinks } from '../../electron/services/reminderStore'
import { syncReminders, type RemindersRemote } from '../../electron/services/reminders'
import { addTask, deleteTask, getTask, listActive, setStatus, updateTask } from '../../electron/services/taskStore'
import { freshStore } from './helpers'

/** Reminders in memory, with the helper's rules: versions, conflicts, a list that can vanish. */
class FakeReminders implements RemindersRemote {
  listId = 'list-1'
  items = new Map<string, AppleReminder>()
  writes = 0
  private next = 0
  private clock = Date.now()

  stamp(): string {
    this.clock += 1000
    return new Date(this.clock).toISOString()
  }

  async ensureList(id: string | null) {
    const created = id !== this.listId
    return { id: this.listId, title: 'AmbientMind', account: 'iCloud', created }
  }

  async list(listId: string) {
    if (listId !== this.listId) throw new HelperError('list_missing', 'gone')
    return [...this.items.values()].map((item) => ({ ...item }))
  }

  async upsert(write: ReminderWrite) {
    this.writes++
    let item: AppleReminder
    if (write.id) {
      const existing = this.items.get(write.id)
      if (!existing) throw new HelperError('not_found', 'gone')
      if (write.expectedModifiedAt && write.expectedModifiedAt !== existing.modifiedAt) throw new HelperError('conflict', 'changed')
      item = { ...existing }
    } else {
      item = {
        id: `r${++this.next}`,
        title: '',
        notes: null,
        due: null,
        dueAllDay: false,
        priority: 0,
        completed: false,
        completedAt: null,
        modifiedAt: null,
        recurring: false
      }
    }
    if (write.title !== undefined) item.title = write.title
    if (write.notes !== undefined) item.notes = write.notes
    if (write.due !== undefined) item.due = write.due
    if (write.priority !== undefined) item.priority = write.priority
    if (write.completed !== undefined) {
      item.completed = write.completed
      item.completedAt = write.completed ? this.stamp() : null
    }
    item.modifiedAt = this.stamp()
    this.items.set(item.id, item)
    return { ...item }
  }

  async remove(id: string, expectedModifiedAt?: string | null) {
    const existing = this.items.get(id)
    if (!existing) return false
    if (expectedModifiedAt && expectedModifiedAt !== existing.modifiedAt) throw new HelperError('conflict', 'changed')
    this.items.delete(id)
    return true
  }

  /** An edit on the iPhone. */
  edit(id: string, change: Partial<AppleReminder>) {
    const item = this.items.get(id)!
    this.items.set(id, { ...item, ...change, modifiedAt: this.stamp() })
  }

  add(change: Partial<AppleReminder>) {
    const id = `phone-${++this.next}`
    this.items.set(id, {
      id,
      title: 'From the phone',
      notes: null,
      due: null,
      dueAllDay: false,
      priority: 0,
      completed: false,
      completedAt: null,
      modifiedAt: this.stamp(),
      recurring: false,
      ...change
    })
    return id
  }
}

const LIST = { id: 'list-1', title: 'AmbientMind', account: 'iCloud' }

test('open tasks go to Reminders once, and a quiet second pass writes nothing', async () => {
  freshStore()
  const remote = new FakeReminders()
  addTask({ title: 'Send the invoice', priority: 'high', evidence: 'Can you send it?' })
  setStatus(addTask({ title: 'Already done' }).id, 'done')

  const first = await syncReminders(remote, LIST)
  assert.equal(first.pushed, 1)
  const [item] = remote.items.values()
  assert.equal(item?.title, 'Send the invoice')
  assert.equal(item?.priority, 1)
  assert.equal(item?.notes, 'Can you send it?')

  const writes = remote.writes
  const second = await syncReminders(remote, LIST)
  assert.equal(second.pushed + second.pulled, 0)
  assert.equal(remote.writes, writes)
})

test('a reminder added on the iPhone appears here, and completing it there clears it here', async () => {
  freshStore()
  const remote = new FakeReminders()
  const id = remote.add({ title: 'Buy stamps', priority: 9 })
  const first = await syncReminders(remote, LIST)
  assert.ok(first.changedLocal)
  const task = listActive().find((t) => t.title === 'Buy stamps')
  assert.ok(task)
  assert.equal(task.source, 'reminders')
  assert.equal(task.priority, 'low')

  remote.edit(id, { completed: true, completedAt: new Date().toISOString() })
  await syncReminders(remote, LIST)
  assert.equal(getTask(task.id)?.status, 'done')
})

test('completing or editing here reaches Reminders', async () => {
  freshStore()
  const remote = new FakeReminders()
  const task = addTask({ title: 'Call Priya' })
  await syncReminders(remote, LIST)
  updateTask(task.id, { title: 'Call Priya about the venue' })
  setStatus(task.id, 'done')
  await syncReminders(remote, LIST)
  const [item] = remote.items.values()
  assert.equal(item?.title, 'Call Priya about the venue')
  assert.equal(item?.completed, true)
})

test('deleting here deletes the reminder; deleting there deletes the task, as a tombstone', async () => {
  freshStore()
  const remote = new FakeReminders()
  const here = addTask({ title: 'Delete me here' })
  const there = addTask({ title: 'Delete me there' })
  await syncReminders(remote, LIST)
  const thereId = listReminderLinks().find((l) => l.taskId === there.id)!.externalId

  deleteTask(here.id)
  remote.items.delete(thereId)
  await syncReminders(remote, LIST)

  assert.deepEqual([...remote.items.values()].map((r) => r.title), [])
  assert.equal(getTask(there.id)?.status, 'deleted')
  assert.equal(countReminderLinks(), 0)
})

test('an edit on the iPhone after a delete here brings the task back', async () => {
  freshStore()
  const remote = new FakeReminders()
  const task = addTask({ title: 'Maybe' })
  await syncReminders(remote, LIST)
  deleteTask(task.id)
  const id = listReminderLinks()[0]!.externalId
  // Later than the delete, by the fake's clock.
  remote.edit(id, { title: 'Definitely' })
  await syncReminders(remote, LIST)
  assert.equal(getTask(task.id)?.status, 'pending')
  assert.equal(getTask(task.id)?.title, 'Definitely')
})

test('a write planned against an old version is refused and retried, not forced', async () => {
  freshStore()
  const remote = new FakeReminders()
  const task = addTask({ title: 'Draft' })
  await syncReminders(remote, LIST)
  const id = listReminderLinks()[0]!.externalId
  updateTask(task.id, { title: 'Draft v2' })
  const original = remote.upsert.bind(remote)
  let raced = false
  remote.upsert = async (write) => {
    if (!raced && write.id) {
      raced = true
      remote.edit(id, { notes: 'edited meanwhile' })
    }
    return original(write)
  }
  const report = await syncReminders(remote, LIST)
  assert.equal(report.conflicts, 1)
  assert.equal(remote.items.get(id)?.title, 'Draft')
  await syncReminders(remote, LIST)
  assert.equal(remote.items.get(id)?.title, 'Draft v2')
  assert.equal(remote.items.get(id)?.notes, 'edited meanwhile')
})

test('a list made again drops old links and offers open tasks to the new one', async () => {
  freshStore()
  const remote = new FakeReminders()
  addTask({ title: 'Survivor' })
  await syncReminders(remote, LIST)
  remote.listId = 'list-2'
  remote.items.clear()
  const report = await syncReminders(remote, LIST)
  assert.equal(report.list.id, 'list-2')
  assert.equal(report.pushed, 1)
  assert.equal(listActive().filter((t) => t.status === 'pending').length, 1)
})

test('migration 013 admits the new sources and keeps updated_at current', () => {
  const db = freshStore()
  const task = addTask({ title: 'Meeting prep', source: 'acalendar', sourceId: 'uid@x' })
  const before = db.prepare<[string], { updated_at: string }>(`SELECT updated_at FROM tasks WHERE id = ?`).get(task.id)!
  assert.ok(before.updated_at)
  db.prepare(`UPDATE tasks SET updated_at = '2000-01-01T00:00:00.000Z' WHERE id = ?`).run(task.id)
  setStatus(task.id, 'done')
  const after = db.prepare<[string], { updated_at: string }>(`SELECT updated_at FROM tasks WHERE id = ?`).get(task.id)!
  assert.ok(after.updated_at > '2000-01-02')
})
