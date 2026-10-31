import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { app } from 'electron'
import * as sqliteVec from 'sqlite-vec'
import { PREP_LEAD_HOURS } from '@shared/calendarPrep'
import { KEEP_TOMBSTONE_DAYS } from '@shared/retention'
import type { Task, TaskPriority, TaskSource } from '@shared/types'
import { migrate } from './migrations'

/** Completed tasks stay visible briefly, then archive out of the overlay. */
const ARCHIVE_AFTER_HOURS = 24

interface TaskRow {
  id: string
  title: string
  deadline: string | null
  priority: TaskPriority
  source: TaskSource
  source_id: string | null
  people: string
  raw_context: string | null
  confidence: number
  status: Task['status']
  created_at: string
  completed_at: string | null
  snoozed_until: string | null
}

export interface NewTask {
  title: string
  deadline?: string | null
  priority?: TaskPriority
  source?: TaskSource
  sourceId?: string | null
  people?: string[]
  rawContext?: string | null
  confidence?: number
}

function toTask(row: TaskRow): Task {
  return {
    id: row.id,
    title: row.title,
    deadline: row.deadline,
    priority: row.priority,
    source: row.source,
    sourceId: row.source_id,
    people: JSON.parse(row.people) as string[],
    rawContext: row.raw_context,
    confidence: row.confidence,
    status: row.status,
    createdAt: row.created_at,
    completedAt: row.completed_at,
    snoozedUntil: row.snoozed_until
  }
}

let db: Database.Database | null = null
let openedPath: string | null = null

export function openTaskStore(filename?: string) {
  const path = filename ?? join(app.getPath('userData'), 'ambientmind.db')
  openedPath = path
  db = new Database(path)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  // Must precede migrate(): migration 002 creates a vec0 virtual table.
  // In a packaged build the extension resolves to a path inside app.asar,
  // which dlopen cannot read; electron-builder unpacks it next door.
  db.loadExtension(sqliteVec.getLoadablePath().replace('app.asar', 'app.asar.unpacked'))
  migrate(db)
  return db
}

function handle(): Database.Database {
  if (!db) throw new Error('Task store used before openTaskStore()')
  return db
}

export function getTaskStore(): Database.Database {
  return handle()
}

export function taskStorePath(): string | null {
  return openedPath
}

export function closeTaskStore() {
  db?.close()
  db = null
  openedPath = null
}

/** Everything the overlay may need to render, archived rows excluded. */
export function listActive(): Task[] {
  return handle()
    .prepare<[], TaskRow>(
      `SELECT * FROM tasks WHERE status IN ('pending', 'done', 'snoozed') ORDER BY created_at DESC`
    )
    .all()
    .map(toTask)
}

export function addTask(input: NewTask): Task {
  const row: TaskRow = {
    id: randomUUID(),
    title: input.title.trim(),
    deadline: input.deadline ?? null,
    priority: input.priority ?? 'medium',
    source: input.source ?? 'manual',
    source_id: input.sourceId ?? null,
    people: JSON.stringify(input.people ?? []),
    raw_context: input.rawContext ?? null,
    confidence: input.confidence ?? 1,
    status: 'pending',
    created_at: new Date().toISOString(),
    completed_at: null,
    snoozed_until: null
  }

  handle()
    .prepare(
      `INSERT INTO tasks (id, title, deadline, priority, source, source_id, people, raw_context, confidence, status, created_at, completed_at, snoozed_until)
       VALUES (@id, @title, @deadline, @priority, @source, @source_id, @people, @raw_context, @confidence, @status, @created_at, @completed_at, @snoozed_until)`
    )
    .run(row)

  return toTask(row)
}

/**
 * Used by the sync pipeline: relies on the partial unique index over
 * (source, source_id) so a re-processed email is skipped rather than duplicated.
 * Returns the tasks that were actually new.
 */
export function addTasksIgnoringDuplicates(inputs: NewTask[]): Task[] {
  const inserted: Task[] = []
  handle().transaction(() => {
    for (const input of inputs) {
      try {
        inserted.push(addTask(input))
      } catch (err) {
        const code = (err as { code?: string }).code
        if (code !== 'SQLITE_CONSTRAINT_UNIQUE') throw err
      }
    }
  })()
  return inserted
}

export interface TaskPatch {
  title?: string
  deadline?: string | null
  priority?: TaskPriority
  people?: string[]
}

export function updateTask(id: string, patch: TaskPatch): void {
  const columns: Record<keyof TaskPatch, string> = {
    title: 'title',
    deadline: 'deadline',
    priority: 'priority',
    people: 'people'
  }

  const assignments: string[] = []
  const params: unknown[] = []
  for (const [key, column] of Object.entries(columns) as [keyof TaskPatch, string][]) {
    if (!(key in patch)) continue
    assignments.push(`${column} = ?`)
    params.push(key === 'people' ? JSON.stringify(patch.people ?? []) : patch[key])
  }
  if (assignments.length === 0) return

  // Marks the row as the user's, so background refreshes stop rewriting it.
  assignments.push('user_edited_at = ?')
  params.push(new Date().toISOString(), id)
  handle()
    .prepare(`UPDATE tasks SET ${assignments.join(', ')} WHERE id = ? AND status != 'deleted'`)
    .run(...params)
}

export interface CalendarReconcile {
  /** Meetings with no task yet; they still go through dedup and suppression. */
  fresh: NewTask[]
  updated: number
  removed: number
  archived: number
}

/**
 * Brings calendar prep tasks in line with the current lookahead window.
 * `prep` must be the complete set for the window: an open prep task whose
 * meeting is not in it was cancelled, declined or moved away, and goes.
 * Completed and deleted rows are history and are never touched.
 */
export function reconcileCalendarTasks(prep: NewTask[], now = new Date()): CalendarReconcile {
  const db = handle()
  const result: CalendarReconcile = { fresh: [], updated: 0, removed: 0, archived: 0 }

  db.transaction(() => {
    const seen = new Set<string>()
    const find = db.prepare<[string], { id: string; status: Task['status']; user_edited_at: string | null }>(
      `SELECT id, status, user_edited_at FROM tasks WHERE source = 'gcalendar' AND source_id = ?`
    )
    const refresh = db.prepare(
      `UPDATE tasks SET deadline = @deadline, people = @people, raw_context = @raw_context,
              title = CASE WHEN user_edited_at IS NULL THEN @title ELSE title END
        WHERE id = @id`
    )

    for (const task of prep) {
      if (!task.sourceId) continue
      seen.add(task.sourceId)
      const row = find.get(task.sourceId)
      if (!row) {
        result.fresh.push(task)
        continue
      }
      if (row.status !== 'pending' && row.status !== 'snoozed') continue
      result.updated += refresh.run({
        id: row.id,
        title: task.title.trim(),
        deadline: task.deadline ?? null,
        people: JSON.stringify(task.people ?? []),
        raw_context: task.rawContext ?? null
      }).changes
    }

    const startedBefore = new Date(now.getTime() - PREP_LEAD_HOURS * 3_600_000).toISOString()
    const open = db
      .prepare<[], { id: string; source_id: string; deadline: string | null }>(
        `SELECT id, source_id, deadline FROM tasks
          WHERE source = 'gcalendar' AND status IN ('pending', 'snoozed')`
      )
      .all()
    for (const row of open) {
      if (row.deadline && row.deadline < startedBefore) {
        db.prepare(`UPDATE tasks SET status = 'archived', snoozed_until = NULL WHERE id = ?`).run(row.id)
        result.archived++
      } else if (!seen.has(row.source_id)) {
        db.prepare(`DELETE FROM tasks WHERE id = ?`).run(row.id)
        result.removed++
      }
    }
  })()

  return result
}

export function setStatus(id: string, status: Task['status']): void {
  handle()
    .prepare(
      `UPDATE tasks SET status = ?, completed_at = ?, snoozed_until = NULL
        WHERE id = ? AND status != 'deleted'`
    )
    .run(status, status === 'done' ? new Date().toISOString() : null, id)
}

/** Hides the task until `until`; wakeSnoozed() brings it back as pending. */
export function snoozeTask(id: string, until: string): void {
  handle()
    .prepare(
      `UPDATE tasks SET status = 'snoozed', snoozed_until = ? WHERE id = ? AND status != 'deleted'`
    )
    .run(until, id)
}

export function wakeSnoozed(now = Date.now()): number {
  return handle()
    .prepare(
      `UPDATE tasks SET status = 'pending', snoozed_until = NULL
       WHERE status = 'snoozed' AND snoozed_until IS NOT NULL AND snoozed_until <= ?`
    )
    .run(new Date(now).toISOString()).changes
}

export function getTask(id: string): Task | null {
  const row = handle()
    .prepare<[string], TaskRow>(`SELECT * FROM tasks WHERE id = ?`)
    .get(id)
  return row ? toTask(row) : null
}

/**
 * Leaves a tombstone rather than removing the row: the row is what holds the
 * (source, source_id) slot, so removing it let the next sync import the same
 * email, event or recurring occurrence again.
 */
export function deleteTask(id: string): void {
  handle()
    .prepare(
      `UPDATE tasks SET status = 'deleted', deleted_at = ?, snoozed_until = NULL WHERE id = ?`
    )
    .run(new Date().toISOString(), id)
}

export function purgeTombstones(now = Date.now(), days = KEEP_TOMBSTONE_DAYS): number {
  const cutoff = new Date(now - days * 86_400_000).toISOString()
  return handle()
    .prepare(`DELETE FROM tasks WHERE status = 'deleted' AND deleted_at < ?`)
    .run(cutoff).changes
}

export type ProcessOutcome = 'extracted' | 'skipped' | 'failed'

/**
 * How many times a message may fail before it is left alone. Three covers a
 * restart or a flaky connection without re-reading a genuinely unparseable
 * message on every pass forever.
 */
export const MAX_ATTEMPTS = 3

export function isProcessed(source: TaskSource, sourceId: string): boolean {
  const row = handle()
    .prepare<[string, string], { outcome: string; attempts: number }>(
      `SELECT outcome, attempts FROM processed_messages WHERE source = ? AND source_id = ?`
    )
    .get(source, sourceId)

  if (!row) return false
  // A failure is not a verdict. Anything that threw is worth another look,
  // because the usual causes — no network, an expired token, Ollama
  // restarting — say nothing about the message itself.
  if (row.outcome === 'failed') return row.attempts >= MAX_ATTEMPTS
  return true
}

export function markProcessed(
  source: TaskSource,
  sourceId: string,
  outcome: ProcessOutcome,
  tasksFound = 0
): void {
  handle()
    .prepare(
      `INSERT INTO processed_messages (source, source_id, outcome, tasks_found, processed_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (source, source_id) DO UPDATE SET
         outcome = excluded.outcome,
         tasks_found = excluded.tasks_found,
         processed_at = excluded.processed_at,
         -- Reaching a verdict clears the failure history behind it.
         attempts = 0`
    )
    .run(source, sourceId, outcome, tasksFound, new Date().toISOString())
}

/**
 * Records a failed attempt and reports whether the message will be retried.
 * Separate from `markProcessed` because a failure has to accumulate rather
 * than overwrite.
 */
export function markFailed(source: TaskSource, sourceId: string): { willRetry: boolean } {
  const row = handle()
    .prepare<[string, string, string], { attempts: number }>(
      `INSERT INTO processed_messages (source, source_id, outcome, tasks_found, processed_at, attempts)
       VALUES (?, ?, 'failed', 0, ?, 1)
       ON CONFLICT (source, source_id) DO UPDATE SET
         outcome = 'failed',
         processed_at = excluded.processed_at,
         attempts = processed_messages.attempts + 1
       RETURNING attempts`
    )
    .get(source, sourceId, new Date().toISOString())

  return { willRetry: (row?.attempts ?? MAX_ATTEMPTS) < MAX_ATTEMPTS }
}

/**
 * Message ids that failed and still have attempts left.
 *
 * Needed because the sync window is only a couple of days wide: a message that
 * failed during an outage longer than that ages out of the listing and is
 * never offered again, which would have left the retry budget unusable in
 * exactly the situation it was built for. These are fetched by id instead.
 */
export function listRetryableFailures(source: TaskSource, limit = 25): string[] {
  return handle()
    .prepare<[string, number, number], { source_id: string }>(
      `SELECT source_id FROM processed_messages
       WHERE source = ? AND outcome = 'failed' AND attempts < ?
       ORDER BY processed_at DESC LIMIT ?`
    )
    .all(source, MAX_ATTEMPTS, limit)
    .map((row) => row.source_id)
}

/**
 * Manual Sync re-reads recent mail that yielded nothing, so a 0-task extraction
 * is not sticky forever. Messages that did produce tasks are left alone:
 * re-reading them is how deleted and edited tasks used to come back.
 */
export function forgetRecentGmail(hours = 48): number {
  const cutoff = new Date(Date.now() - hours * 3_600_000).toISOString()
  return handle()
    .prepare(
      `DELETE FROM processed_messages
        WHERE source = 'gmail' AND processed_at >= ? AND tasks_found = 0`
    )
    .run(cutoff).changes
}

export function getSyncState(source: string): { cursor: string | null; lastRun: string | null } {
  const row = handle()
    .prepare<[string], { cursor: string | null; last_run: string | null }>(
      `SELECT cursor, last_run FROM sync_state WHERE source = ?`
    )
    .get(source)
  return { cursor: row?.cursor ?? null, lastRun: row?.last_run ?? null }
}

export function listSyncStates(): {
  source: string
  lastRun: string | null
  lastError: string | null
}[] {
  return handle()
    .prepare<[], { source: string; last_run: string | null; last_error: string | null }>(
      `SELECT source, last_run, last_error FROM sync_state`
    )
    .all()
    .map((row) => ({ source: row.source, lastRun: row.last_run, lastError: row.last_error }))
}

export function setSyncState(source: string, cursor: string | null, error?: string | null): void {
  handle()
    .prepare(
      `INSERT INTO sync_state (source, cursor, last_run, last_error) VALUES (?, ?, ?, ?)
       ON CONFLICT (source) DO UPDATE SET
         cursor = excluded.cursor,
         last_run = excluded.last_run,
         last_error = excluded.last_error`
    )
    .run(source, cursor, new Date().toISOString(), error ?? null)
}

/** Sweeps completed tasks out of the overlay once they have aged out. */
export function archiveStaleCompleted(now = Date.now()): number {
  const cutoff = new Date(now - ARCHIVE_AFTER_HOURS * 3_600_000).toISOString()
  return handle()
    .prepare(`UPDATE tasks SET status = 'archived' WHERE status = 'done' AND completed_at < ?`)
    .run(cutoff).changes
}
