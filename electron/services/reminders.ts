import { HelperError, type AppleReminder, type ReminderWrite } from '@shared/helperProtocol'
import { QA_LIVE_TITLE } from '@shared/qaPolicy'
import { planReminderSync, reminderFields, taskFields } from '@shared/remindersSync'
import {
  applyReminderFields,
  dropAllReminderLinks,
  dropReminderLink,
  listReminderLinks,
  reminderSyncTasks,
  saveReminderLink
} from './reminderStore'
import { addTasksIgnoringDuplicates, deleteTask, getTask, reopenTask } from './taskStore'

/** A QA instance's helper refuses any other list, so yours is never touched. */
export const REMINDERS_LIST_TITLE = process.env.AMBIENTMIND_QA === '1' ? QA_LIVE_TITLE : 'AmbientMind'

export interface ReminderList {
  id: string
  title: string
  account: string
}

/** What sync needs from Reminders; the helper in the app, a fake in tests. */
export interface RemindersRemote {
  ensureList(id: string | null): Promise<ReminderList & { created: boolean }>
  list(listId: string): Promise<AppleReminder[]>
  upsert(write: ReminderWrite): Promise<AppleReminder>
  remove(id: string, expectedModifiedAt?: string | null): Promise<boolean>
}

export interface RemindersReport {
  list: ReminderList
  pushed: number
  pulled: number
  /** Planned against a reminder that changed meanwhile; the next pass picks it up. */
  conflicts: number
  /** Tasks were added, changed or removed here. */
  changedLocal: boolean
  errors: string[]
}

function relink(taskId: string, reminder: AppleReminder) {
  const task = getTask(taskId)
  if (!task) return
  saveReminderLink({
    taskId,
    externalId: reminder.id,
    modifiedAt: reminder.modifiedAt,
    local: taskFields(task),
    remote: reminderFields(reminder)
  })
}

/**
 * One pass: makes sure the list exists, reads it, plans, and applies. A list
 * that had to be made again means the old links point at nothing; they go,
 * and open tasks are offered to the new list rather than deleted.
 */
export async function syncReminders(remote: RemindersRemote, known: ReminderList | null): Promise<RemindersReport> {
  const ensured = await remote.ensureList(known?.id ?? null)
  const list: ReminderList = { id: ensured.id, title: ensured.title, account: ensured.account }
  if (known && known.id !== list.id) dropAllReminderLinks()

  const report: RemindersReport = { list, pushed: 0, pulled: 0, conflicts: 0, changedLocal: false, errors: [] }
  const reminders = await remote.list(list.id)
  const ops = planReminderSync({ tasks: reminderSyncTasks(), links: listReminderLinks(), reminders })

  for (const op of ops) {
    try {
      switch (op.kind) {
        case 'create-remote': {
          const created = await remote.upsert({ listId: list.id, ...op.write })
          relink(op.task.id, created)
          report.pushed++
          break
        }
        case 'create-local': {
          const fields = reminderFields(op.reminder)
          const [task] = addTasksIgnoringDuplicates([
            {
              title: fields.title,
              deadline: fields.deadline,
              priority: fields.priority,
              source: 'reminders',
              sourceId: op.reminder.id,
              rawContext: op.reminder.notes
            }
          ])
          if (task) {
            relink(task.id, op.reminder)
            report.pulled++
            report.changedLocal = true
          }
          break
        }
        case 'merge': {
          let current = op.reminder
          if (Object.keys(op.write).length > 0) {
            current = await remote.upsert({ id: op.link.externalId, expectedModifiedAt: op.reminder.modifiedAt, ...op.write })
            report.pushed++
          }
          if (Object.keys(op.patch).length > 0) {
            applyReminderFields(op.task.id, op.patch, op.reminder.completedAt)
            report.pulled++
            report.changedLocal = true
          }
          relink(op.task.id, current)
          break
        }
        case 'delete-remote':
          await remote.remove(op.link.externalId, op.force ? undefined : op.reminder.modifiedAt)
          dropReminderLink(op.link.taskId)
          report.pushed++
          break
        case 'restore-local':
          reopenTask(op.task.id)
          applyReminderFields(op.task.id, reminderFields(op.reminder), op.reminder.completedAt)
          relink(op.task.id, op.reminder)
          report.pulled++
          report.changedLocal = true
          break
        case 'delete-local':
          deleteTask(op.task.id)
          dropReminderLink(op.link.taskId)
          report.pulled++
          report.changedLocal = true
          break
        case 'unlink':
          dropReminderLink(op.link.taskId)
          break
      }
    } catch (err) {
      // Changed or removed between reading the list and writing: the next pass sees the new state.
      if (err instanceof HelperError && (err.code === 'conflict' || err.code === 'not_found')) report.conflicts++
      else report.errors.push(`${op.kind}: ${(err as Error).message}`)
    }
  }
  return report
}
