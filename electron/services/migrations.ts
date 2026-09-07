import type Database from 'better-sqlite3'
import init from '../../db/migrations/001_init.sql?raw'

/**
 * Order is the version. Append only; never edit a migration that has shipped.
 * Imported as raw strings so the SQL is bundled into the build rather than
 * being read from a path that does not exist inside the packaged asar.
 */
const MIGRATIONS: string[] = [init]

export function migrate(db: Database.Database) {
  const current = db.pragma('user_version', { simple: true }) as number

  for (let version = current; version < MIGRATIONS.length; version++) {
    const sql = MIGRATIONS[version]
    if (!sql) continue
    db.transaction(() => {
      db.exec(sql)
      db.pragma(`user_version = ${version + 1}`)
    })()
  }
}
