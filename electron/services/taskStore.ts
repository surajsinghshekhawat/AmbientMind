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
    completedAt: row.completed_at
  }
}

let db: Database.Database | null = null

export function openTaskStore(filename?: string) {
  const path = filename ?? join(app.getPath('userData'), 'ambientmind.db')
  db = new Database(path)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  // Must precede migrate(): migration 002 creates a vec0 virtual table.
  db.loadExtension(sqliteVec.getLoadablePath())
  migrate(db)
  return db
}

function handle(): Database.Database {
  if (!db) throw new Error('Task store used before openTaskStore()')
  return db
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
    completed_at: null
  }

  handle()
    .prepare(
      `INSERT INTO tasks (id, title, deadline, priority, source, source_id, people, raw_context, confidence, status, created_at, completed_at)
       VALUES (@id, @title, @deadline, @priority, @source, @source_id, @people, @raw_context, @confidence, @status, @created_at, @completed_at)`
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
    .prepare(`UPDATE tasks SET status = ?, completed_at = ? WHERE id = ?`)
    .run(status, status === 'done' ? new Date().toISOString() : null, id)
}

export function deleteTask(id: string): void {
  handle().prepare(`DELETE FROM tasks WHERE id = ?`).run(id)
}

/** Sweeps completed tasks out of the overlay once they have aged out. */
export function archiveStaleCompleted(now = Date.now()): number {
  const cutoff = new Date(now - ARCHIVE_AFTER_HOURS * 3_600_000).toISOString()
  return handle()
    .prepare(`UPDATE tasks SET status = 'archived' WHERE status = 'done' AND completed_at < ?`)
    .run(cutoff).changes
}
