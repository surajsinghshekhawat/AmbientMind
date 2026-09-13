/**
 * Runs the pending migrations against a COPY of the live database and reports
 * whether the data survived. Migration 005 rebuilds the tasks table, which is
 * exactly the kind of change worth rehearsing before it touches real rows.
 *
 *   npx electron ./scripts/check-migration.cjs
 */
const { app } = require('electron')
const { copyFileSync, existsSync, readdirSync, readFileSync, rmSync } = require('node:fs')
const path = require('node:path')
const Database = require('better-sqlite3')
const sqliteVec = require('sqlite-vec')

app.setName('ambientmind')
app.setPath('userData', path.join(app.getPath('appData'), 'ambientmind'))

app.whenReady().then(() => {
  try {
    const live = path.join(app.getPath('userData'), 'ambientmind.db')
    if (!existsSync(live)) {
      console.log('NO_DB')
      return app.exit(0)
    }

    const copy = path.join(app.getPath('temp'), `ambientmind-migration-check-${Date.now()}.db`)
    copyFileSync(live, copy)

    const db = new Database(copy)
    db.pragma('journal_mode = WAL')
    db.loadExtension(sqliteVec.getLoadablePath())

    const before = db.prepare('SELECT COUNT(*) AS n FROM tasks').get().n
    const startVersion = db.pragma('user_version', { simple: true })
    console.log('VERSION_BEFORE', startVersion)
    console.log('TASKS_BEFORE', before)

    const dir = path.join(__dirname, '..', 'db', 'migrations')
    const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()

    for (let version = startVersion; version < files.length; version++) {
      const file = files[version]
      const sql = readFileSync(path.join(dir, file), 'utf8')
      db.transaction(() => {
        db.exec(sql)
        db.pragma(`user_version = ${version + 1}`)
      })()
      console.log('APPLIED', file)
    }

    const after = db.prepare('SELECT COUNT(*) AS n FROM tasks').get().n
    console.log('VERSION_AFTER', db.pragma('user_version', { simple: true }))
    console.log('TASKS_AFTER', after)
    console.log('TASKS_PRESERVED', before === after)

    // The whole point of the rebuild: 'rule' must now be a legal source.
    db.prepare(
      `INSERT INTO tasks (id, title, priority, source, source_id, people, confidence, status, created_at)
       VALUES ('probe', 'probe', 'medium', 'rule', 'probe:2026-01-01', '[]', 1.0, 'pending', datetime('now'))`
    ).run()
    console.log('RULE_SOURCE_ACCEPTED true')

    db.prepare(`INSERT INTO recurrence_rules
      (id, title, weekdays, time_of_day, priority, lead_minutes, enabled, created_at, source)
      VALUES ('r1', 'tuition', '[2,4,6]', '17:00', 'medium', 0, 1, datetime('now'), 'explicit')`).run()
    console.log('RULES_TABLE_OK', db.prepare('SELECT COUNT(*) AS n FROM recurrence_rules').get().n)

    // Migration 007: previously-failed mail must come back up for retry
    // rather than staying permanently retired.
    db.prepare(
      `INSERT INTO processed_messages (source, source_id, outcome, tasks_found, processed_at, attempts)
       VALUES ('gmail', 'probe-failed', 'failed', 0, datetime('now'), 1)`
    ).run()
    const retryable = db
      .prepare(
        `SELECT COUNT(*) AS n FROM processed_messages
         WHERE outcome = 'failed' AND attempts < 3`
      )
      .get().n
    console.log('RETRYABLE_FAILURES', retryable)
    console.log(
      'SEEDED_OLD_FAILURES',
      db.prepare(`SELECT COUNT(*) AS n FROM processed_messages WHERE outcome = 'failed'`).get().n
    )

    db.close()
    rmSync(copy, { force: true })
    rmSync(`${copy}-wal`, { force: true })
    rmSync(`${copy}-shm`, { force: true })
    console.log('OK')
    app.exit(0)
  } catch (err) {
    console.error('MIGRATION_CHECK_FAILED', err.message)
    app.exit(1)
  }
})
