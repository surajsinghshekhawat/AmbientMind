import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { RestoreError, restoreEncryptedBackup, writeEncryptedBackup } from '../../electron/services/backup'
import { recordDecision } from '../../electron/services/decisionStore'
import { forgetBefore, forgetSource, storedCounts } from '../../electron/services/inventory'
import { addTask, getTask, listActive, markProcessed, openTaskStore, setStatus, taskStorePath } from '../../electron/services/taskStore'
import { storeExample } from '../../electron/services/vectorStore'
import { freshStore } from './helpers'

const vector = () => Array.from({ length: 768 }, (_, i) => (i === 0 ? 1 : 0))

test('screen and chat are sources of their own', () => {
  freshStore()
  addTask({ title: 'Reply to the screen', source: 'screen' })
  addTask({ title: 'From chat', source: 'chat' })
  addTask({ title: 'Spoken', source: 'voice' })
  assert.deepEqual(listActive().map((task) => task.source).sort(), ['chat', 'screen', 'voice'])
})

test('counts are per source, with deleted tasks apart', () => {
  const db = freshStore()
  addTask({ title: 'A', source: 'gmail', sourceId: 'm1' })
  const done = addTask({ title: 'B', source: 'gmail', sourceId: 'm2' })
  setStatus(done.id, 'done')
  const gone = addTask({ title: 'C', source: 'manual' })
  setStatus(gone.id, 'deleted')
  markProcessed('gmail', 'm1', 'extracted', 1)
  storeExample(db, 'seed text', [], vector(), { source: 'seed' })
  storeExample(db, 'mail text', [], vector(), { source: 'observed', sourceId: 'm1' })

  const counts = storedCounts(db)
  assert.deepEqual(counts.tasks, [{ source: 'gmail', open: 1, finished: 1 }])
  assert.equal(counts.tombstones, 1)
  assert.equal(counts.itemsRead, 1)
  // Seeds ship with the app; they aren't anything of yours.
  assert.equal(counts.examples, 1)
  assert.ok(counts.oldest)
})

test('forgetting Gmail leaves content-free tombstones and drops learned mail', () => {
  const db = freshStore()
  const mail = addTask({ title: 'Send the Q3 report', source: 'gmail', sourceId: 'm1', people: ['Priya'], rawContext: 'Can you send…' })
  const mine = addTask({ title: 'Buy milk', source: 'manual' })
  recordDecision({ kind: 'deleted', title: 'Send the Q3 report', source: 'gmail' })
  recordDecision({ kind: 'deleted', title: 'Buy milk', source: 'manual' })
  storeExample(db, 'seed text', [], vector(), { source: 'seed' })
  storeExample(db, 'Can you send the Q3 report?', [], vector(), { source: 'observed', sourceId: 'm1' })

  assert.ok(forgetSource(db, 'gmail') >= 3)

  const tombstone = db.prepare('SELECT * FROM tasks WHERE id = ?').get(mail.id) as Record<string, unknown>
  assert.equal(tombstone.status, 'deleted')
  assert.equal(tombstone.title, '')
  assert.equal(tombstone.raw_context, null)
  assert.equal(tombstone.people, '[]')
  // Still there, by id, so the next sync doesn't add the same mail back.
  assert.equal(tombstone.source_id, 'm1')
  assert.equal(getTask(mine.id)?.title, 'Buy milk')
  assert.deepEqual(
    (db.prepare('SELECT source FROM decisions').all() as { source: string }[]).map((row) => row.source),
    ['manual']
  )
  assert.deepEqual(
    (db.prepare('SELECT source FROM examples').all() as { source: string }[]).map((row) => row.source),
    ['seed']
  )
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM example_vectors').get() as { n: number }).n, 1)
})

test('forgetting by date keeps the open list', () => {
  const db = freshStore()
  const old = '2026-01-01T09:00:00.000Z'
  const oldDone = addTask({ title: 'Old and done', source: 'manual' })
  const oldOpen = addTask({ title: 'Old and open', source: 'manual' })
  const recentDone = addTask({ title: 'Recent and done', source: 'manual' })
  setStatus(oldDone.id, 'done')
  setStatus(recentDone.id, 'done')
  db.prepare('UPDATE tasks SET created_at = ?, completed_at = ? WHERE id = ?').run(old, old, oldDone.id)
  db.prepare('UPDATE tasks SET created_at = ? WHERE id = ?').run(old, oldOpen.id)
  markProcessed('gmail', 'old-mail', 'skipped')
  db.prepare('UPDATE processed_messages SET processed_at = ?').run(old)
  markProcessed('gmail', 'new-mail', 'skipped')

  forgetBefore(db, '2026-06-01T00:00:00.000Z')

  assert.equal(getTask(oldDone.id), null)
  assert.equal(getTask(oldOpen.id)?.title, 'Old and open')
  assert.equal(getTask(recentDone.id)?.title, 'Recent and done')
  assert.deepEqual(
    (db.prepare('SELECT source_id FROM processed_messages').all() as { source_id: string }[]).map((row) => row.source_id),
    ['new-mail']
  )
})

test('a backup carrying a trigger the app never made is refused', () => {
  const db = freshStore()
  addTask({ title: 'Keep me', source: 'manual' })
  const live = taskStorePath()!
  const file = join(dirname(live), 'evil.amb')
  db.exec('CREATE TRIGGER evil AFTER INSERT ON tasks BEGIN DELETE FROM tasks; END')
  writeEncryptedBackup(file, 'correct horse')
  db.exec('DROP TRIGGER evil')

  assert.throws(() => restoreEncryptedBackup(file, 'correct horse'), /didn’t create/)
  assert.deepEqual(listActive().map((task) => task.title), ['Keep me'])
  assert.equal(existsSync(join(dirname(live), 'ambientmind.before-restore.db')), false)
})

test('a backup whose own trigger was rewritten is refused', () => {
  const db = freshStore()
  const live = taskStorePath()!
  const file = join(dirname(live), 'rewritten.amb')
  const original = (db.prepare("SELECT sql FROM sqlite_master WHERE name = 'tasks_touch'").get() as { sql: string }).sql
  db.exec('DROP TRIGGER tasks_touch')
  db.exec('CREATE TRIGGER tasks_touch AFTER UPDATE ON tasks BEGIN DELETE FROM tasks; END')
  writeEncryptedBackup(file, 'correct horse')
  db.exec('DROP TRIGGER tasks_touch')
  db.exec(original)

  assert.throws(() => restoreEncryptedBackup(file, 'correct horse'), RestoreError)
})

test('a backup restores over later changes, and keeps the replaced copy', () => {
  freshStore()
  addTask({ title: 'Before the backup', source: 'manual' })
  const live = taskStorePath()!
  const file = join(dirname(live), 'test.amb')
  writeEncryptedBackup(file, 'correct horse')
  addTask({ title: 'After the backup', source: 'manual' })

  restoreEncryptedBackup(file, 'correct horse')
  openTaskStore(live)

  assert.deepEqual(listActive().map((task) => task.title), ['Before the backup'])
  assert.ok(existsSync(join(dirname(live), 'ambientmind.before-restore.db')))
})

test('a wrong passphrase changes nothing', () => {
  freshStore()
  addTask({ title: 'Keep me', source: 'manual' })
  const file = join(dirname(taskStorePath()!), 'test.amb')
  writeEncryptedBackup(file, 'correct horse')

  assert.throws(() => restoreEncryptedBackup(file, 'wrong horse!'), RestoreError)
  assert.deepEqual(listActive().map((task) => task.title), ['Keep me'])
})
