import type Database from 'better-sqlite3'
import type { ExtractedTask } from './ollama'

/** nomic-embed-text output width; must match the vec0 column in migration 002. */
export const EMBEDDING_DIM = 768

export interface StoredExample {
  id: number
  message: string
  tasks: ExtractedTask[]
  feedback: -1 | 0 | 1
  distance: number
}

/**
 * Vector rowids must be bound as BigInt: better-sqlite3 hands plain JS numbers
 * to sqlite-vec as doubles, and vec0 rejects a non-integer primary key.
 */
function toRowId(id: number): bigint {
  return BigInt(id)
}

function assertDim(vector: number[]) {
  if (vector.length !== EMBEDDING_DIM) {
    throw new Error(`Expected a ${EMBEDDING_DIM}-dim embedding, received ${vector.length}`)
  }
}

export function storeExample(
  db: Database.Database,
  message: string,
  tasks: ExtractedTask[],
  embedding: number[],
  source: 'seed' | 'observed' | 'feedback' = 'observed'
): number {
  assertDim(embedding)

  return db.transaction(() => {
    const { lastInsertRowid } = db
      .prepare(
        `INSERT INTO examples (message, tasks, source, created_at) VALUES (?, ?, ?, ?)`
      )
      .run(message, JSON.stringify(tasks), source, new Date().toISOString())

    const id = Number(lastInsertRowid)
    db.prepare(`INSERT INTO example_vectors (rowid, embedding) VALUES (?, ?)`).run(
      toRowId(id),
      new Float32Array(embedding)
    )
    return id
  })()
}

export function setFeedback(db: Database.Database, exampleId: number, feedback: -1 | 0 | 1): void {
  db.prepare(`UPDATE examples SET feedback = ?, source = 'feedback' WHERE id = ?`).run(
    feedback,
    exampleId
  )
}

export function nearestExamples(
  db: Database.Database,
  embedding: number[],
  limit = 5
): StoredExample[] {
  assertDim(embedding)

  const rows = db
    .prepare<
      [Float32Array, number],
      { id: number; message: string; tasks: string; feedback: -1 | 0 | 1; distance: number }
    >(
      `SELECT e.id, e.message, e.tasks, e.feedback, v.distance
         FROM example_vectors v
         JOIN examples e ON e.id = v.rowid
        WHERE v.embedding MATCH ? AND k = ?
        ORDER BY v.distance`
    )
    .all(new Float32Array(embedding), limit)

  return rows.map((row) => ({
    id: row.id,
    message: row.message,
    tasks: JSON.parse(row.tasks) as ExtractedTask[],
    feedback: row.feedback,
    distance: row.distance
  }))
}

/** Keeps prompt growth bounded; a 3B model's context is the scarce resource. */
const MAX_EXAMPLE_CHARS = 600

/**
 * Renders retrieved neighbours as few-shot examples. Thumbs-down examples are
 * included but relabelled as empty extractions, which teaches the model the
 * user's boundary for "not a task" instead of merely hiding the mistake.
 */
export function renderFewShot(examples: StoredExample[]): string {
  if (examples.length === 0) return ''

  const blocks = examples.map((example) => {
    const body =
      example.message.length > MAX_EXAMPLE_CHARS
        ? `${example.message.slice(0, MAX_EXAMPLE_CHARS)}…`
        : example.message
    const tasks = example.feedback === -1 ? [] : example.tasks
    return `MESSAGE:\n${body}\n\nEXTRACTED:\n${JSON.stringify({ tasks }, null, 0)}`
  })

  return `--- EXAMPLES FROM THIS USER'S HISTORY ---\n${blocks.join(
    '\n\n---\n\n'
  )}\n--- END EXAMPLES ---`
}
