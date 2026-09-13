import type Database from 'better-sqlite3'
import init from '../../db/migrations/001_init.sql?raw'
import rag from '../../db/migrations/002_rag.sql?raw'
import sync from '../../db/migrations/003_sync.sql?raw'
import snooze from '../../db/migrations/004_snooze.sql?raw'
import rules from '../../db/migrations/005_rules.sql?raw'
import suggestions from '../../db/migrations/006_suggestions.sql?raw'
import retry from '../../db/migrations/007_retry.sql?raw'
import ruleCalendar from '../../db/migrations/008_rule_calendar.sql?raw'

/**
 * Order is the version. Append only; never edit a migration that has shipped.
 * Imported as raw strings so the SQL is bundled into the build rather than
 * being read from a path that does not exist inside the packaged asar.
 */
const MIGRATIONS: string[] = [
  init,
  rag,
  sync,
  snooze,
  rules,
  suggestions,
  retry,
  ruleCalendar
]

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
