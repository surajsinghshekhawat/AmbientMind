import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'

/**
 * Layout: magic "AMBK1" | 16-byte salt | 12-byte iv | 16-byte GCM tag | ciphertext
 *
 * The wrapping is ordinary Node crypto so the eval harness can round-trip a
 * buffer without loading Electron. The main-process backup service is the
 * only thing that ever reads the live SQLite file.
 */
export const BACKUP_MAGIC = Buffer.from('AMBK1')

export function wrapBackup(plaintext: Buffer, passphrase: string): Buffer {
  if (passphrase.length < 8) {
    throw new Error('Passphrase must be at least 8 characters')
  }
  const salt = randomBytes(16)
  const iv = randomBytes(12)
  const key = scryptSync(passphrase, salt, 32, { N: 16384, r: 8, p: 1 })
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([BACKUP_MAGIC, salt, iv, tag, ciphertext])
}

export function unwrapBackup(blob: Buffer, passphrase: string): Buffer {
  if (blob.length < BACKUP_MAGIC.length + 16 + 12 + 16) {
    throw new Error('Backup file is truncated')
  }
  if (!blob.subarray(0, BACKUP_MAGIC.length).equals(BACKUP_MAGIC)) {
    throw new Error('Not an AmbientMind backup')
  }
  let offset = BACKUP_MAGIC.length
  const salt = blob.subarray(offset, offset + 16)
  offset += 16
  const iv = blob.subarray(offset, offset + 12)
  offset += 12
  const tag = blob.subarray(offset, offset + 16)
  offset += 16
  const ciphertext = blob.subarray(offset)
  const key = scryptSync(passphrase, salt, 32, { N: 16384, r: 8, p: 1 })
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()])
}
