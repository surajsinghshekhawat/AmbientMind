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

export interface StoreExampleOptions {
  source?: 'seed' | 'observed' | 'feedback'
  /** The message this came from, so a task can later rate its own example. */
  sourceId?: string
  embedVersion?: number
}

export function storeExample(
  db: Database.Database,
  message: string,
  tasks: ExtractedTask[],
  embedding: number[],
  options: StoreExampleOptions = {}
): number {
  assertDim(embedding)
  const { source = 'observed', sourceId = null, embedVersion = 0 } = options

  return db.transaction(() => {
    const { lastInsertRowid } = db
      .prepare(
        `INSERT INTO examples (message, tasks, source, source_id, embed_version, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        message,
        JSON.stringify(tasks),
        source,
        sourceId,
        embedVersion,
        new Date().toISOString()
      )

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

/**
 * Rates the example a task came from.
 *
 * A completion is sticky and a deletion cannot overturn it, which is the same
 * asymmetry the decision memory uses for suppression: a wrongly negative
 * example quietly teaches the model to extract less, and the user has no way
 * to see that happening. Being slow to distrust an example is the safe
 * direction to be wrong.
 */
export function rateExampleBySource(
  db: Database.Database,
  sourceId: string,
  feedback: -1 | 1
): boolean {
  const clause = feedback === -1 ? 'AND feedback <> 1' : ''
  const { changes } = db
    .prepare(
      `UPDATE examples SET feedback = ?, source = 'feedback'
        WHERE source_id = ? ${clause}`
    )
    .run(feedback, sourceId)
  return changes > 0
}

/**
 * Recovers the message id a task was extracted from. Gmail sourceIds are
 * `${messageId}:${titlePrefix}` and Gmail ids are hex, so the first segment is
 * unambiguous. Anything not extracted from mail has no example to rate.
 */
export function messageIdFromTask(task: {
  source: string
  sourceId?: string | null
}): string | null {
  if (task.source !== 'gmail' || !task.sourceId) return null
  return task.sourceId.split(':')[0] || null
}

/** Rows whose vectors predate the current embedding convention. */
export function staleEmbeddings(
  db: Database.Database,
  version: number,
  limit: number
): { id: number; message: string }[] {
  return db
    .prepare<[number, number], { id: number; message: string }>(
      `SELECT id, message FROM examples WHERE embed_version < ? ORDER BY id LIMIT ?`
    )
    .all(version, limit)
}

/**
 * Swaps in a new vector and stores the exact text it was produced from, so a
 * row's vector always corresponds to text that still exists. Re-embedding is
 * also the only moment a pre-cap row is rewritten, so the truncation happens
 * here rather than in a separate migration pass over the whole table.
 */
export function replaceEmbedding(
  db: Database.Database,
  id: number,
  message: string,
  embedding: number[],
  version: number
): void {
  assertDim(embedding)
  db.transaction(() => {
    db.prepare(`DELETE FROM example_vectors WHERE rowid = ?`).run(toRowId(id))
    db.prepare(`INSERT INTO example_vectors (rowid, embedding) VALUES (?, ?)`).run(
      toRowId(id),
      new Float32Array(embedding)
    )
    db.prepare(`UPDATE examples SET message = ?, embed_version = ? WHERE id = ?`).run(
      message,
      version,
      id
    )
  })()
}

/**
 * Caps the corpus. sqlite-vec scans every stored vector on every query, so an
 * unbounded store does not merely take disk — it makes each sync slower than
 * the last, forever, with nothing to signal it.
 *
 * Rated examples are never evicted: they are the only supervision the system
 * has, and they are rare compared to the unrated bulk.
 */
export function pruneExamples(db: Database.Database, keep: number): number {
  const doomed = db
    .prepare<[number], { id: number }>(
      `SELECT id FROM examples
        WHERE feedback = 0
          AND id NOT IN (SELECT id FROM examples ORDER BY created_at DESC, id DESC LIMIT ?)
        ORDER BY created_at ASC`
    )
    .all(keep)

  if (doomed.length === 0) return 0

  return db.transaction(() => {
    const dropVector = db.prepare(`DELETE FROM example_vectors WHERE rowid = ?`)
    const dropExample = db.prepare(`DELETE FROM examples WHERE id = ?`)
    for (const { id } of doomed) {
      dropVector.run(toRowId(id))
      dropExample.run(id)
    }
    return doomed.length
  })()
}

export function exampleCount(db: Database.Database): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM examples').get() as { n: number }).n
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
 * Hard cap on retained example text.
 *
 * renderFewShot never shows more than MAX_EXAMPLE_CHARS, so anything beyond
 * this is stored and never read — and `examples` is not encrypted, which makes
 * an uncapped column a plaintext archive of the user's inbox accumulated as a
 * side effect of caching. Applied on write and again on re-embed, so rows
 * written before the cap existed are shortened as they are repaired.
 */
export const EXAMPLE_TEXT_CHARS = 1200

export function truncateExample(text: string): string {
  return text.length > EXAMPLE_TEXT_CHARS ? `${text.slice(0, EXAMPLE_TEXT_CHARS)}…` : text
}

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
