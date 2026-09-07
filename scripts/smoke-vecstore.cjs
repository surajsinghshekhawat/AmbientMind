// Exercises the real migration SQL and the exact KNN join used by
// vectorStore.ts, against a throwaway on-disk database.
const { app } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')

const DIM = 768

function randomVector(seedTerm) {
  const v = new Array(DIM)
  for (let i = 0; i < DIM; i++) v[i] = Math.sin((i + 1) * seedTerm)
  const norm = Math.hypot(...v)
  return v.map((x) => x / norm)
}

app.whenReady().then(() => {
  const file = path.join(os.tmpdir(), `ambientmind-vec-${Date.now()}.db`)
  try {
    const Database = require('better-sqlite3')
    const sqliteVec = require('sqlite-vec')
    const root = path.join(__dirname, '..')

    const db = new Database(file)
    db.pragma('journal_mode = WAL')
    db.loadExtension(sqliteVec.getLoadablePath())

    for (const name of ['001_init.sql', '002_rag.sql']) {
      db.exec(fs.readFileSync(path.join(root, 'db', 'migrations', name), 'utf8'))
    }
    db.pragma('user_version = 2')

    const insertExample = db.prepare(
      'INSERT INTO examples (message, tasks, source, created_at) VALUES (?, ?, ?, ?)'
    )
    const insertVector = db.prepare(
      'INSERT INTO example_vectors (rowid, embedding) VALUES (?, ?)'
    )

    const corpus = [
      ['Please send the Q1 numbers by EOD', 1.0],
      ['Unsubscribe from our newsletter', 2.0],
      ['Can you send the Q1 volume report today', 1.02]
    ]
    for (const [message, seed] of corpus) {
      const { lastInsertRowid } = insertExample.run(message, '[]', 'seed', new Date().toISOString())
      insertVector.run(BigInt(Number(lastInsertRowid)), new Float32Array(randomVector(seed)))
    }

    const rows = db
      .prepare(
        `SELECT e.id, e.message, v.distance
           FROM example_vectors v
           JOIN examples e ON e.id = v.rowid
          WHERE v.embedding MATCH ? AND k = ?
          ORDER BY v.distance`
      )
      .all(new Float32Array(randomVector(1.0)), 2)

    const ids = rows.map((r) => r.id).join(',')
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type IN ('table','index') ORDER BY name")
      .all()
      .map((r) => r.name)

    console.log(`VECSTORE_OK version=${db.pragma('user_version', { simple: true })} nearest=${ids}`)
    console.log(`VECSTORE_TABLES ${tables.join(' ')}`)
    db.close()
    // Expect the near-duplicate (id 3) ranked above the unrelated newsletter.
    process.exit(ids === '1,3' ? 0 : 2)
  } catch (err) {
    console.log('VECSTORE_FAIL', err.message)
    process.exit(1)
  } finally {
    for (const suffix of ['', '-wal', '-shm']) {
      fs.rmSync(file + suffix, { force: true })
    }
  }
})
