import type Database from 'better-sqlite3'
import init from '../../db/migrations/001_init.sql?raw'
import rag from '../../db/migrations/002_rag.sql?raw'
import sync from '../../db/migrations/003_sync.sql?raw'
import snooze from '../../db/migrations/004_snooze.sql?raw'
import rules from '../../db/migrations/005_rules.sql?raw'
import suggestions from '../../db/migrations/006_suggestions.sql?raw'
import retry from '../../db/migrations/007_retry.sql?raw'
import ruleCalendar from '../../db/migrations/008_rule_calendar.sql?raw'
import decisions from '../../db/migrations/009_decisions.sql?raw'
import exampleFeedback from '../../db/migrations/010_example_feedback.sql?raw'
import taskLifecycle from '../../db/migrations/011_task_lifecycle.sql?raw'
import exampleDedupe from '../../db/migrations/012_example_dedupe.sql?raw'
import appleSources from '../../db/migrations/013_apple_sources.sql?raw'
import screenChatSources from '../../db/migrations/014_screen_chat_sources.sql?raw'
import dueAlerts from '../../db/migrations/015_due_alerts.sql?raw'

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
  ruleCalendar,
  decisions,
  exampleFeedback,
  taskLifecycle,
  exampleDedupe,
  appleSources,
  screenChatSources,
  dueAlerts
]

/** The schema version a fully migrated database reports. */
export const MIGRATION_COUNT = MIGRATIONS.length

export function migrate(db: Database.Database) {
  migrateTo(db, MIGRATIONS.length)
}

/** Brings a database up to `target`; restore uses it to build a reference schema. */
export function migrateTo(db: Database.Database, target: number) {
  const current = db.pragma('user_version', { simple: true }) as number

  for (let version = current; version < Math.min(target, MIGRATIONS.length); version++) {
    const sql = MIGRATIONS[version]
    if (!sql) continue
    db.transaction(() => {
      db.exec(sql)
      db.pragma(`user_version = ${version + 1}`)
    })()
  }
}
