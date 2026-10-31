import { END_OF_DAY_HOUR } from './deadline'
import type { AppleReminder, ReminderWrite } from './helperProtocol'
import type { Task, TaskPriority } from './types'

/**
 * Two-way sync between tasks and the "AmbientMind" list in Reminders, as a
 * pure plan. Each link keeps what both sides looked like at the last sync, so
 * a change is a field that differs from that snapshot, not a guess from
 * clocks. A field changed on one side goes to the other; the same field
 * changed on both goes to the later edit. Deletes are tombstones on both
 * sides, and every remote write names the version it was planned against.
 */

export interface SyncFields {
  title: string
  deadline: string | null
  priority: TaskPriority
  done: boolean
}

export const SYNCED_FIELDS: (keyof SyncFields)[] = ['title', 'deadline', 'priority', 'done']

export interface ReminderLink {
  taskId: string
  externalId: string
  modifiedAt: string | null
  local: SyncFields
  remote: SyncFields
}

export type SyncTask = Pick<Task, 'id' | 'title' | 'deadline' | 'priority' | 'status' | 'evidence' | 'sourceUrl'> & {
  updatedAt: string | null
  deletedAt: string | null
}

export type ReminderOp =
  /** An open task with no reminder yet. */
  | { kind: 'create-remote'; task: SyncTask; write: ReminderWrite }
  /** A reminder made elsewhere becomes a task. */
  | { kind: 'create-local'; reminder: AppleReminder }
  /** Both exist: write what changed here, apply what changed there. Either may be empty. */
  | { kind: 'merge'; link: ReminderLink; task: SyncTask; reminder: AppleReminder; write: ReminderWrite; patch: Partial<SyncFields> }
  /** Deleted here: remove the reminder, unless it changed since (then the task comes back). */
  | { kind: 'delete-remote'; link: ReminderLink; reminder: AppleReminder; force: boolean }
  /** Edited in Reminders after it was deleted here: the later edit wins. */
  | { kind: 'restore-local'; link: ReminderLink; task: SyncTask; reminder: AppleReminder }
  /** Deleted in Reminders: the open task goes too. */
  | { kind: 'delete-local'; link: ReminderLink; task: SyncTask }
  /** Nothing left to keep in step. */
  | { kind: 'unlink'; link: ReminderLink }

/** Reminders shows three levels; medium is the default here, so it stays unmarked there. */
export function toReminderPriority(priority: TaskPriority): number {
  if (priority === 'urgent' || priority === 'high') return 1
  if (priority === 'low') return 9
  return 0
}

export function fromReminderPriority(priority: number): TaskPriority {
  if (priority >= 1 && priority <= 4) return 'high'
  if (priority >= 6 && priority <= 9) return 'low'
  return 'medium'
}

export function taskFields(task: Pick<Task, 'title' | 'deadline' | 'priority' | 'status'>): SyncFields {
  return {
    title: task.title,
    deadline: task.deadline,
    priority: task.priority,
    done: task.status === 'done' || task.status === 'archived'
  }
}

/** A date-only reminder is due that day, at the same hour a typed "Friday" means. */
export function reminderFields(reminder: AppleReminder): SyncFields {
  let deadline: string | null = null
  if (reminder.due) {
    const due = new Date(reminder.due)
    if (reminder.dueAllDay) due.setHours(END_OF_DAY_HOUR, 0, 0, 0)
    deadline = due.toISOString()
  }
  return {
    title: reminder.title.trim() || 'Untitled reminder',
    deadline,
    priority: fromReminderPriority(reminder.priority),
    done: reminder.completed
  }
}

function same<K extends keyof SyncFields>(key: K, a: SyncFields[K], b: SyncFields[K]): boolean {
  if (key === 'deadline') {
    if (a === null || b === null) return a === b
    return Date.parse(a as string) === Date.parse(b as string)
  }
  return a === b
}

function changed(before: SyncFields, after: SyncFields): (keyof SyncFields)[] {
  return SYNCED_FIELDS.filter((key) => !same(key, before[key], after[key]))
}

export function writeFor(fields: Partial<SyncFields>): ReminderWrite {
  const write: ReminderWrite = {}
  if (fields.title !== undefined) write.title = fields.title
  if (fields.deadline !== undefined) write.due = fields.deadline
  if (fields.priority !== undefined) write.priority = toReminderPriority(fields.priority)
  if (fields.done !== undefined) write.completed = fields.done
  return write
}

const later = (a: string | null, b: string | null) => (Date.parse(a ?? '') || 0) > (Date.parse(b ?? '') || 0)

function open(task: SyncTask): boolean {
  return task.status === 'pending' || task.status === 'snoozed'
}

/**
 * More than this many reminders vanishing in one pass looks like a list
 * deleted or an account signed out, not a person tidying up; nothing is
 * deleted here, and the tasks are offered to Reminders again instead.
 */
export function massVanishLimit(links: number): number {
  return Math.max(5, Math.floor(links / 2))
}

export function planReminderSync(input: {
  tasks: SyncTask[]
  links: ReminderLink[]
  reminders: AppleReminder[]
}): ReminderOp[] {
  const ops: ReminderOp[] = []
  const tasks = new Map(input.tasks.map((task) => [task.id, task]))
  const reminders = new Map(input.reminders.map((reminder) => [reminder.id, reminder]))
  const linkedTasks = new Set(input.links.map((link) => link.taskId))
  const linkedReminders = new Set(input.links.map((link) => link.externalId))
  const vanished: { link: ReminderLink; task: SyncTask }[] = []

  for (const link of input.links) {
    const task = tasks.get(link.taskId)
    const reminder = reminders.get(link.externalId)

    if (!task || task.status === 'deleted') {
      if (!reminder) ops.push({ kind: 'unlink', link })
      else if (!task) ops.push({ kind: 'delete-remote', link, reminder, force: true })
      else if (reminder.modifiedAt !== link.modifiedAt && later(reminder.modifiedAt, task.deletedAt)) {
        ops.push({ kind: 'restore-local', link, task, reminder })
      } else ops.push({ kind: 'delete-remote', link, reminder, force: false })
      continue
    }

    if (!reminder) {
      if (open(task)) vanished.push({ link, task })
      else ops.push({ kind: 'unlink', link })
      continue
    }
    if (task.status === 'suggested') continue

    const localNow = taskFields(task)
    const remoteNow = reminderFields(reminder)
    const local = changed(link.local, localNow)
    const remote = reminder.modifiedAt === link.modifiedAt ? [] : changed(link.remote, remoteNow)
    const push: Partial<SyncFields> = {}
    const patch: Partial<SyncFields> = {}
    for (const key of new Set([...local, ...remote])) {
      if (same(key, localNow[key], remoteNow[key])) continue
      const remoteWins = remote.includes(key) && (!local.includes(key) || later(reminder.modifiedAt, task.updatedAt))
      if (remoteWins) Object.assign(patch, { [key]: remoteNow[key] })
      else Object.assign(push, { [key]: localNow[key] })
    }
    const write = writeFor(push)
    if (Object.keys(write).length > 0 || Object.keys(patch).length > 0 || reminder.modifiedAt !== link.modifiedAt) {
      ops.push({ kind: 'merge', link, task, reminder, write, patch })
    }
  }

  if (vanished.length > massVanishLimit(input.links.length)) {
    for (const { link } of vanished) ops.push({ kind: 'unlink', link })
  } else {
    for (const { link, task } of vanished) ops.push({ kind: 'delete-local', link, task })
  }

  for (const task of input.tasks) {
    if (linkedTasks.has(task.id) || !open(task)) continue
    ops.push({
      kind: 'create-remote',
      task,
      write: {
        ...writeFor(taskFields(task)),
        notes: [task.evidence, task.sourceUrl].filter(Boolean).join('\n\n') || null
      }
    })
  }

  for (const reminder of input.reminders) {
    if (linkedReminders.has(reminder.id) || reminder.completed) continue
    ops.push({ kind: 'create-local', reminder })
  }
  return ops
}
