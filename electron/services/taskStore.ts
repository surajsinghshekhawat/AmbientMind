import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { app } from 'electron'
import * as sqliteVec from 'sqlite-vec'
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

export function openTaskStore(filename?: string) {
  const path = filename ?? join(app.getPath('userData'), 'ambientmind.db')
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

export function closeTaskStore() {
  db?.close()
  db = null
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

  params.push(id)
  handle()
    .prepare(`UPDATE tasks SET ${assignments.join(', ')} WHERE id = ?`)
    .run(...params)
}

export function setStatus(id: string, status: Task['status']): void {
  handle()
    .prepare(`UPDATE tasks SET status = ?, completed_at = ?, snoozed_until = NULL WHERE id = ?`)
    .run(status, status === 'done' ? new Date().toISOString() : null, id)
}

/** Hides the task until `until`; wakeSnoozed() brings it back as pending. */
export function snoozeTask(id: string, until: string): void {
  handle()
    .prepare(`UPDATE tasks SET status = 'snoozed', snoozed_until = ? WHERE id = ?`)
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

export function deleteTask(id: string): void {
  handle().prepare(`DELETE FROM tasks WHERE id = ?`).run(id)
}

export type ProcessOutcome = 'extracted' | 'skipped' | 'failed'

export function isProcessed(source: TaskSource, sourceId: string): boolean {
  return (
    handle()
      .prepare(`SELECT 1 FROM processed_messages WHERE source = ? AND source_id = ?`)
      .get(source, sourceId) !== undefined
  )
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
         processed_at = excluded.processed_at`
    )
    .run(source, sourceId, outcome, tasksFound, new Date().toISOString())
}

/** Manual Sync now must re-read recent mail; otherwise a 0-task extraction is sticky forever. */
export function forgetRecentGmail(hours = 48): number {
  const cutoff = new Date(Date.now() - hours * 3_600_000).toISOString()
  return handle()
    .prepare(`DELETE FROM processed_messages WHERE source = 'gmail' AND processed_at >= ?`)
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
