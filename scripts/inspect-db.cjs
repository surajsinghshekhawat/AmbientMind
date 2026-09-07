// Reports the live database's schema version and row counts. Safe to run while
// the app is open: WAL mode allows a concurrent reader.
const { app } = require('electron')
const path = require('node:path')

// Running a bare script means Electron does not read the project's
// package.json, so userData would default to the generic "Electron" folder
// rather than the app's. Pin the name before anything resolves a path.
app.setName('ambientmind')
app.setPath('userData', path.join(app.getPath('appData'), 'ambientmind'))

app.whenReady().then(() => {
  try {
    inspect()
  } catch (err) {
    console.log('INSPECT_FAIL', err.message)
    process.exit(1)
  }
})

function inspect() {
  const Database = require('better-sqlite3')
  const sqliteVec = require('sqlite-vec')
  const file = path.join(app.getPath('userData'), 'ambientmind.db')

  // Not readonly: a WAL database needs to create its -shm file, which a
  // readonly handle cannot do when no writer is attached.
  const db = new Database(file)
  db.loadExtension(sqliteVec.getLoadablePath())

  const count = (table) => {
    try {
      return db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n
    } catch {
      return 'missing'
    }
  }

  console.log(`DB ${file}`)
  console.log(`user_version = ${db.pragma('user_version', { simple: true })}`)
  for (const table of ['tasks', 'examples', 'processed_messages', 'sync_state']) {
    console.log(`  ${table.padEnd(20)} ${count(table)}`)
  }
  db.close()
  process.exit(0)
}
