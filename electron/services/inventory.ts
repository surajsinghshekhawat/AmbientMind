import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import type Database from 'better-sqlite3'
import type { ErasableSource, SourceCount } from '@shared/privacy'
import type { TaskSource } from '@shared/types'

/**
 * What the database holds, and the two ways to forget part of it. Files
 * outside the database (chat history, the logs) are counted by the caller.
 */

export interface StoredCounts {
  tasks: SourceCount[]
  tombstones: number
  itemsRead: number
  examples: number
  decisions: number
  rules: number
  oldest: string | null
}

function count(db: Database.Database, sql: string, ...params: unknown[]): number {
  return (db.prepare(sql).get(...params) as { n: number }).n
}

export function storedCounts(db: Database.Database): StoredCounts {
  const rows = db
    .prepare<[], { source: TaskSource; open: number; finished: number }>(
      `SELECT source,
              SUM(status IN ('pending', 'snoozed', 'suggested')) AS open,
              SUM(status IN ('done', 'archived')) AS finished
         FROM tasks
        WHERE status != 'deleted'
        GROUP BY source
        ORDER BY COUNT(*) DESC, source`
    )
    .all()
  const oldest = db
    .prepare<[], { at: string | null }>(
      `SELECT MIN(at) AS at FROM (
         SELECT MIN(created_at) AS at FROM tasks
         UNION ALL SELECT MIN(processed_at) FROM processed_messages
         UNION ALL SELECT MIN(created_at) FROM examples WHERE source != 'seed'
         UNION ALL SELECT MIN(decided_at) FROM decisions)`
    )
    .get()
  return {
    tasks: rows,
    tombstones: count(db, `SELECT COUNT(*) AS n FROM tasks WHERE status = 'deleted'`),
    itemsRead: count(db, 'SELECT COUNT(*) AS n FROM processed_messages'),
    examples: count(db, `SELECT COUNT(*) AS n FROM examples WHERE source != 'seed'`),
    decisions: count(db, 'SELECT COUNT(*) AS n FROM decisions'),
    rules: count(db, 'SELECT COUNT(*) AS n FROM recurrence_rules'),
    oldest: oldest?.at ?? null
  }
}

function dropExamples(db: Database.Database, where: string, ...params: unknown[]): number {
  const ids = db.prepare<unknown[], { id: number }>(`SELECT id FROM examples WHERE ${where}`).all(...params)
  const dropVector = db.prepare('DELETE FROM example_vectors WHERE rowid = ?')
  const dropExample = db.prepare('DELETE FROM examples WHERE id = ?')
  for (const { id } of ids) {
    dropVector.run(BigInt(id))
    dropExample.run(id)
  }
  return ids.length
}

/**
 * Tasks from the source become content-free tombstones rather than vanishing,
 * so the next sync doesn't add them again, and a copy in Reminders is removed
 * the way any deleted task's is. Ids of mail already read are kept for the
 * same reason; they carry no content.
 */
export function forgetSource(db: Database.Database, source: ErasableSource, now = new Date()): number {
  return db.transaction(() => {
    const tasks = db
      .prepare(
        `UPDATE tasks
            SET status = 'deleted', deleted_at = COALESCE(deleted_at, ?), snoozed_until = NULL,
                title = '', raw_context = NULL, evidence = NULL, people = '[]', source_url = NULL
          WHERE source = ? AND (status != 'deleted' OR title != '')`
      )
      .run(now.toISOString(), source).changes
    const decisions = db.prepare('DELETE FROM decisions WHERE source = ?').run(source).changes
    // Every example the model learns from is a piece of mail.
    const examples = source === 'gmail' ? dropExamples(db, `source != 'seed'`) : 0
    return tasks + decisions + examples
  })()
}

/**
 * Finished and deleted tasks, read-mail ids, decisions and learned examples
 * older than the cutoff. The open list is kept: it is what you're working on.
 */
export function forgetBefore(db: Database.Database, cutoffIso: string): number {
  return db.transaction(() => {
    const tasks = db
      .prepare(
        `DELETE FROM tasks
          WHERE status IN ('done', 'archived', 'deleted')
            AND COALESCE(deleted_at, completed_at, created_at) < ?`
      )
      .run(cutoffIso).changes
    const read = db.prepare('DELETE FROM processed_messages WHERE processed_at < ?').run(cutoffIso).changes
    const decisions = db.prepare('DELETE FROM decisions WHERE decided_at < ?').run(cutoffIso).changes
    const suggestions = db
      .prepare(`DELETE FROM recurrence_suggestions WHERE status != 'pending' AND COALESCE(decided_at, created_at) < ?`)
      .run(cutoffIso).changes
    const examples = dropExamples(db, `source != 'seed' AND created_at < ?`, cutoffIso)
    return tasks + read + decisions + suggestions + examples
  })()
}

/** For the JSON-lines logs, whose entries each carry an ISO `at`. */
export function dropLinesBefore(path: string, cutoffIso: string): number {
  if (!existsSync(path)) return 0
  const lines = readFileSync(path, 'utf8').split('\n').filter(Boolean)
  const kept = lines.filter((line) => {
    try {
      return String((JSON.parse(line) as { at?: unknown }).at ?? '') >= cutoffIso
    } catch {
      return false
    }
  })
  writeFileSync(path, kept.length ? `${kept.join('\n')}\n` : '')
  return lines.length - kept.length
}

/** Readable copy of what's yours; no tokens, no learned mail text. */
export function exportRows(db: Database.Database) {
  const parse = <T extends Record<string, unknown>>(rows: T[], ...jsonColumns: string[]) =>
    rows.map((row) => {
      const out: Record<string, unknown> = { ...row }
      for (const column of jsonColumns) {
        try {
          out[column] = JSON.parse(String(row[column] ?? 'null'))
        } catch {
          // Left as text when it isn't JSON.
        }
      }
      return out
    })
  return {
    tasks: parse(
      db
        .prepare(
          `SELECT id, title, deadline, priority, source, status, people, raw_context, evidence,
                  source_url, created_at, completed_at, snoozed_until
             FROM tasks WHERE status != 'deleted' ORDER BY created_at`
        )
        .all() as Record<string, unknown>[],
      'people'
    ),
    recurringRules: parse(db.prepare('SELECT * FROM recurrence_rules ORDER BY title').all() as Record<string, unknown>[], 'weekdays'),
    decisions: db.prepare('SELECT kind, subject, title, source, detail, decided_at FROM decisions ORDER BY decided_at').all()
  }
}
