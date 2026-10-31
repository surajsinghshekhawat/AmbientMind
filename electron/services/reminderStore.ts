import type { ReminderLink, SyncFields, SyncTask } from '@shared/remindersSync'
import type { Task } from '@shared/types'
import { getTaskStore } from './taskStore'

/** Links between tasks and their reminders, and the writes sync makes to tasks. */

interface LinkRow {
  task_id: string
  external_id: string
  modified_at: string | null
  local_snapshot: string
  remote_snapshot: string
}

export function listReminderLinks(): ReminderLink[] {
  return getTaskStore()
    .prepare<[], LinkRow>(
      `SELECT task_id, external_id, modified_at, local_snapshot, remote_snapshot FROM task_links WHERE provider = 'reminders'`
    )
    .all()
    .map((row) => ({
      taskId: row.task_id,
      externalId: row.external_id,
      modifiedAt: row.modified_at,
      local: JSON.parse(row.local_snapshot) as SyncFields,
      remote: JSON.parse(row.remote_snapshot) as SyncFields
    }))
}

export function saveReminderLink(link: ReminderLink): void {
  const db = getTaskStore()
  db.transaction(() => {
    // A reminder belongs to one task; a stale link to it from another goes.
    db.prepare(`DELETE FROM task_links WHERE provider = 'reminders' AND external_id = ? AND task_id != ?`).run(
      link.externalId,
      link.taskId
    )
    db.prepare(
      `INSERT INTO task_links (task_id, provider, external_id, modified_at, local_snapshot, remote_snapshot, synced_at)
       VALUES (@taskId, 'reminders', @externalId, @modifiedAt, @local, @remote, @syncedAt)
       ON CONFLICT (provider, task_id) DO UPDATE SET
         external_id = excluded.external_id,
         modified_at = excluded.modified_at,
         local_snapshot = excluded.local_snapshot,
         remote_snapshot = excluded.remote_snapshot,
         synced_at = excluded.synced_at`
    ).run({
      taskId: link.taskId,
      externalId: link.externalId,
      modifiedAt: link.modifiedAt,
      local: JSON.stringify(link.local),
      remote: JSON.stringify(link.remote),
      syncedAt: new Date().toISOString()
    })
  })()
}

export function dropReminderLink(taskId: string): void {
  getTaskStore().prepare(`DELETE FROM task_links WHERE provider = 'reminders' AND task_id = ?`).run(taskId)
}

export function dropAllReminderLinks(): number {
  return getTaskStore().prepare(`DELETE FROM task_links WHERE provider = 'reminders'`).run().changes
}

export function countReminderLinks(): number {
  return (
    getTaskStore()
      .prepare<[], { n: number }>(`SELECT COUNT(*) AS n FROM task_links WHERE provider = 'reminders'`)
      .get()?.n ?? 0
  )
}

/** Open tasks, plus any task that has a reminder whatever its state. */
export function reminderSyncTasks(): SyncTask[] {
  return getTaskStore()
    .prepare<
      [],
      Pick<Task, 'id' | 'title' | 'deadline' | 'priority' | 'status'> & {
        evidence: string | null
        source_url: string | null
        updated_at: string | null
        deleted_at: string | null
      }
    >(
      `SELECT id, title, deadline, priority, status, evidence, source_url, updated_at, deleted_at FROM tasks
        WHERE status IN ('pending', 'snoozed')
           OR id IN (SELECT task_id FROM task_links WHERE provider = 'reminders')`
    )
    .all()
    .map((row) => ({
      id: row.id,
      title: row.title,
      deadline: row.deadline,
      priority: row.priority,
      status: row.status,
      evidence: row.evidence,
      sourceUrl: row.source_url,
      updatedAt: row.updated_at,
      deletedAt: row.deleted_at
    }))
}

/**
 * Applies what changed in Reminders. Marked as the user's edit, since it was
 * one, on another device: background enrichment must not undo it.
 */
export function applyReminderFields(taskId: string, patch: Partial<SyncFields>, completedAt: string | null = null): void {
  const db = getTaskStore()
  const now = new Date().toISOString()
  db.transaction(() => {
    const columns = (['title', 'deadline', 'priority'] as const).filter((key) => patch[key] !== undefined)
    const sets = columns.map((key) => `${key} = ?`)
    const params = columns.map((key) => patch[key])
    if (sets.length > 0) {
      db.prepare(`UPDATE tasks SET ${sets.join(', ')}, user_edited_at = ? WHERE id = ?`).run(...params, now, taskId)
    }
    if (patch.done === true) {
      db.prepare(
        `UPDATE tasks SET status = 'done', completed_at = ?, snoozed_until = NULL WHERE id = ? AND status IN ('pending', 'snoozed')`
      ).run(completedAt ?? now, taskId)
    } else if (patch.done === false) {
      db.prepare(
        `UPDATE tasks SET status = 'pending', completed_at = NULL WHERE id = ? AND status IN ('done', 'archived')`
      ).run(taskId)
    }
  })()
}
