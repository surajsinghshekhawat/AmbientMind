import { existsSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import Database from 'better-sqlite3'
import { unwrapBackup, wrapBackup } from '@shared/backupCrypto'
import { MIGRATION_COUNT, migrateTo } from './migrations'
import { closeTaskStore, getTaskStore, taskStorePath, vecExtensionPath } from './taskStore'

export { wrapBackup, unwrapBackup, BACKUP_MAGIC } from '@shared/backupCrypto'

/**
 * Passphrase-protected copy of the task database. secrets.json and the
 * Google client JSON are never part of this file — those stay on the machine
 * that created them.
 */
export function writeEncryptedBackup(destPath: string, passphrase: string): void {
  const source = taskStorePath()
  if (!source) throw new Error('Database is not open')

  // Beside the database rather than in the system temp folder: the plaintext
  // copy never leaves the app's own folder, even for a moment.
  const tmp = join(dirname(source), `backup-${Date.now()}.tmp.db`)
  const escaped = tmp.replace(/'/g, "''")
  getTaskStore().exec(`VACUUM INTO '${escaped}'`)
  try {
    const plaintext = readFileSync(tmp)
    writeFileSync(destPath, wrapBackup(plaintext, passphrase))
  } finally {
    try {
      unlinkSync(tmp)
    } catch (err) {
      console.warn('[backup] could not remove temp copy:', (err as Error).message)
    }
  }
}

export class RestoreError extends Error {}

function schemaOf(db: Database.Database): Map<string, string | null> {
  const rows = db
    .prepare<[], { type: string; name: string; sql: string | null }>('SELECT type, name, sql FROM sqlite_master')
    .all()
  return new Map(rows.filter((row) => !row.name.startsWith('sqlite_stat')).map((row) => [`${row.type} ${row.name}`, row.sql]))
}

/**
 * The first schema object that our own migrations would not have made at this
 * version, or that they would have and is missing. A backup is a file anyone
 * can hand you; a trigger or view smuggled into it would run inside the app.
 * Triggers and views must match exactly; tables and indexes by name, with
 * `trusted_schema = OFF` keeping their expressions harmless.
 */
export function unexpectedSchema(incoming: Database.Database, version: number): string | null {
  const reference = new Database(':memory:')
  try {
    reference.loadExtension(vecExtensionPath())
    migrateTo(reference, version)
    const want = schemaOf(reference)
    const got = schemaOf(incoming)
    for (const [key, sql] of got) {
      if (!want.has(key)) return key
      if ((key.startsWith('trigger ') || key.startsWith('view ')) && want.get(key) !== sql) return key
    }
    for (const key of want.keys()) if (!got.has(key)) return key
    return null
  } finally {
    reference.close()
  }
}

/**
 * Decrypts and checks a backup, then swaps it in for the open database. The
 * current database is kept beside it as `ambientmind.before-restore.db`. The
 * caller relaunches: every service holds the old handle's state.
 */
export function restoreEncryptedBackup(backupPath: string, passphrase: string): void {
  const live = taskStorePath()
  if (!live) throw new Error('Database is not open')

  let plaintext: Buffer
  try {
    plaintext = unwrapBackup(readFileSync(backupPath), passphrase)
  } catch (err) {
    const message = (err as Error).message
    if (/Not an AmbientMind backup|truncated/.test(message)) throw new RestoreError(message)
    throw new RestoreError('Wrong passphrase, or the file is damaged.')
  }

  const folder = dirname(live)
  const incoming = join(folder, `restore-${Date.now()}.tmp.db`)
  writeFileSync(incoming, plaintext)
  try {
    const check = new Database(incoming, { readonly: true })
    try {
      check.pragma('trusted_schema = OFF')
      const ok = check.pragma('integrity_check', { simple: true })
      if (ok !== 'ok') throw new RestoreError('The backup’s database is damaged.')
      const version = check.pragma('user_version', { simple: true }) as number
      if (version > MIGRATION_COUNT) {
        throw new RestoreError('This backup is from a newer version of AmbientMind. Update first, then restore.')
      }
      check.prepare('SELECT COUNT(*) FROM tasks').get()
      const odd = unexpectedSchema(check, version)
      if (odd) {
        console.warn(`[backup] refusing restore: unexpected schema object ${odd}`)
        throw new RestoreError('This backup contains database objects AmbientMind didn’t create, so it wasn’t restored.')
      }
    } finally {
      check.close()
    }
  } catch (err) {
    rmSync(incoming, { force: true })
    if (err instanceof RestoreError) throw err
    throw new RestoreError('The backup doesn’t contain an AmbientMind database.')
  }

  // Checkpoints the WAL into the file, so the kept copy is complete.
  getTaskStore().pragma('wal_checkpoint(TRUNCATE)')
  closeTaskStore()
  const previous = join(folder, 'ambientmind.before-restore.db')
  rmSync(previous, { force: true })
  renameSync(live, previous)
  try {
    for (const suffix of ['-wal', '-shm']) {
      if (existsSync(live + suffix)) rmSync(live + suffix, { force: true })
    }
    renameSync(incoming, live)
  } catch (err) {
    // Put the original back, so reopening finds it rather than an empty file.
    if (!existsSync(live)) renameSync(previous, live)
    rmSync(incoming, { force: true })
    throw err
  }
}
