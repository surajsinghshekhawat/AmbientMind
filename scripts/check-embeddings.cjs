/**
 * Reports how far the embedding backfill has progressed, and whether the
 * feedback loop has any signal in it yet.
 *
 *   npx electron ./scripts/check-embeddings.cjs
 */
const { app } = require('electron')
const path = require('node:path')
const Database = require('better-sqlite3')
const sqliteVec = require('sqlite-vec')

app.setName('ambientmind')
app.setPath('userData', path.join(app.getPath('appData'), 'ambientmind'))

app.whenReady().then(() => {
  try {
    const db = new Database(path.join(app.getPath('userData'), 'ambientmind.db'), {
      readonly: true
    })
    db.loadExtension(sqliteVec.getLoadablePath())

    const one = (sql) => db.prepare(sql).get()

    console.log('user_version    ', db.pragma('user_version', { simple: true }))
    console.log('examples        ', one('SELECT COUNT(*) AS n FROM examples').n)
    for (const row of db
      .prepare('SELECT embed_version AS v, COUNT(*) AS n FROM examples GROUP BY v ORDER BY v')
      .all()) {
      console.log(`  embed_version=${row.v}`.padEnd(18), row.n)
    }
    console.log('  with source_id ', one('SELECT COUNT(*) AS n FROM examples WHERE source_id IS NOT NULL').n)
    console.log('  rated +1       ', one('SELECT COUNT(*) AS n FROM examples WHERE feedback = 1').n)
    console.log('  rated -1       ', one('SELECT COUNT(*) AS n FROM examples WHERE feedback = -1').n)
    console.log(
      'vectors joined  ',
      one('SELECT COUNT(*) AS n FROM examples e JOIN example_vectors v ON e.id = v.rowid').n
    )
    console.log('longest message ', one('SELECT MAX(LENGTH(message)) AS n FROM examples').n)
    console.log('processed_msgs  ', one('SELECT COUNT(*) AS n FROM processed_messages').n)
    console.log('decisions       ', one('SELECT COUNT(*) AS n FROM decisions').n)

    db.close()
    app.exit(0)
  } catch (err) {
    console.error('CHECK_FAILED', err.message)
    app.exit(1)
  }
})
