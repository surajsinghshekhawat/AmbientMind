import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'
import * as sqliteVec from 'sqlite-vec'
import { migrate } from '../../electron/services/migrations'
import {
  EMBEDDING_DIM,
  exampleCount,
  setFeedback,
  storeExample
} from '../../electron/services/vectorStore'
import { freshStore } from './helpers'

const vector = (seed: number) => Array.from({ length: EMBEDDING_DIM }, (_, i) => ((i + seed) % 7) / 7)
const vectorCount = (db: Database.Database) =>
  (db.prepare('SELECT COUNT(*) AS n FROM example_vectors').get() as { n: number }).n

test('re-reading a message updates its example instead of adding another', () => {
  const db = freshStore()
  const first = storeExample(db, 'old text', [], vector(1), { sourceId: 'm1' })
  setFeedback(db, first, 1)
  const second = storeExample(db, 'new text', [{ title: 'Reply' } as never], vector(2), {
    sourceId: 'm1'
  })

  assert.equal(second, first)
  assert.equal(exampleCount(db), 1)
  assert.equal(vectorCount(db), 1)
  const row = db.prepare('SELECT message, feedback FROM examples WHERE id = ?').get(first) as {
    message: string
    feedback: number
  }
  assert.equal(row.message, 'new text')
  assert.equal(row.feedback, 1, 'a rating survives the message being re-read')
})

test('examples without a source id are still stored separately', () => {
  const db = freshStore()
  storeExample(db, 'seed a', [], vector(1), { source: 'seed' })
  storeExample(db, 'seed b', [], vector(2), { source: 'seed' })
  assert.equal(exampleCount(db), 2)
})

test('upgrading collapses duplicate examples and their vectors, keeping rated ones', () => {
  const db = new Database(':memory:')
  db.loadExtension(sqliteVec.getLoadablePath())
  const dir = join(process.cwd(), 'db', 'migrations')
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
  const before = files.indexOf('010_example_feedback.sql') + 1
  for (const file of files.slice(0, before)) db.exec(readFileSync(join(dir, file), 'utf8'))
  db.pragma(`user_version = ${before}`)

  const insert = db.prepare(
    `INSERT INTO examples (id, message, tasks, feedback, source, source_id, created_at)
     VALUES (?, ?, '[]', ?, 'observed', ?, ?)`
  )
  const insertVec = db.prepare(`INSERT INTO example_vectors (rowid, embedding) VALUES (?, ?)`)
  const rows: [number, number, string | null][] = [
    [1, 1, 'm1'],
    [2, 0, 'm1'],
    [3, 0, 'm2'],
    [4, 0, 'm2'],
    [5, 0, null],
    [6, 0, null]
  ]
  for (const [id, feedback, sourceId] of rows) {
    insert.run(id, `msg ${id}`, feedback, sourceId, `2026-01-0${id}T00:00:00.000Z`)
    insertVec.run(BigInt(id), new Float32Array(vector(id)))
  }
  db.prepare(
    `INSERT INTO tasks (id, title, source, source_id, status, created_at)
     VALUES ('t1', 'kept', 'gmail', 'm1:kept', 'snoozed', '2026-01-01T00:00:00.000Z')`
  ).run()

  migrate(db)

  const ids = (db.prepare('SELECT id FROM examples ORDER BY id').all() as { id: number }[]).map(
    (row) => row.id
  )
  assert.deepEqual(ids, [1, 4, 5, 6], 'rated m1 kept; newest m2 kept; unsourced untouched')
  assert.equal(vectorCount(db), 4)

  const task = db.prepare(`SELECT title, status, deleted_at FROM tasks WHERE id = 't1'`).get()
  assert.deepEqual({ ...(task as object) }, { title: 'kept', status: 'snoozed', deleted_at: null })
  db.close()
})
