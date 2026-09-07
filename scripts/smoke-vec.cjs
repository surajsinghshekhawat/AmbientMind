// Verifies sqlite-vec loads into better-sqlite3 under Electron and that
// cosine KNN returns sane neighbours. This is the ChromaDB replacement, so it
// needs to be proven before the RAG layer is built on it.
const { app } = require('electron')

app.whenReady().then(() => {
  try {
    const Database = require('better-sqlite3')
    const sqliteVec = require('sqlite-vec')

    const db = new Database(':memory:')
    db.loadExtension(sqliteVec.getLoadablePath())

    const version = db.prepare('select vec_version() as v').get().v
    db.exec('CREATE VIRTUAL TABLE v USING vec0(embedding float[4])')

    const insert = db.prepare('INSERT INTO v (rowid, embedding) VALUES (?, ?)')
    insert.run(BigInt(1), new Float32Array([1, 0, 0, 0]))
    insert.run(BigInt(2), new Float32Array([0, 1, 0, 0]))
    insert.run(BigInt(3), new Float32Array([0.9, 0.1, 0, 0]))

    const rows = db
      .prepare('SELECT rowid, distance FROM v WHERE embedding MATCH ? ORDER BY distance LIMIT 2')
      .all(new Float32Array([1, 0, 0, 0]))

    const order = rows.map((r) => r.rowid).join(',')
    console.log(`VEC_OK version=${version} nearest=${order}`)
    process.exit(order === '1,3' ? 0 : 2)
  } catch (err) {
    console.log('VEC_FAIL', err.message)
    process.exit(1)
  }
})
