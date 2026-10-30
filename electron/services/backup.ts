import { readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { wrapBackup } from '@shared/backupCrypto'
import { getTaskStore, taskStorePath } from './taskStore'

export { wrapBackup, unwrapBackup, BACKUP_MAGIC } from '@shared/backupCrypto'

/**
 * Passphrase-protected copy of the task database. secrets.json and the
 * Google client JSON are never part of this file — those stay on the machine
 * that created them, bound to DPAPI.
 */
export function writeEncryptedBackup(destPath: string, passphrase: string): void {
  const source = taskStorePath()
  if (!source) throw new Error('Database is not open')

  const tmp = join(tmpdir(), `ambientmind-backup-${Date.now()}.db`)
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
