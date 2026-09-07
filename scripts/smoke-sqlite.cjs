// Verifies better-sqlite3 loads against Electron's ABI, not just Node's.
const { app } = require('electron')

app.whenReady().then(() => {
  try {
    const Database = require('better-sqlite3')
    const db = new Database(':memory:')
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)')
    db.prepare('INSERT INTO t (v) VALUES (?)').run('ok')
    const row = db.prepare('SELECT v FROM t').get()
    console.log('SQLITE_OK', row.v, 'sqlite', db.prepare('select sqlite_version() as v').get().v)
    db.close()
    process.exit(0)
  } catch (err) {
    console.log('SQLITE_FAIL', err.message)
    process.exit(1)
  }
})
