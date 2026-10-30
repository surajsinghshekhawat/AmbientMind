import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, safeStorage } from 'electron'

/**
 * OAuth token storage, replacing the keytar dependency in the original design:
 * keytar is archived and unmaintained, and being a native module it would need
 * rebuilding on every Electron bump. safeStorage ships with Electron and uses
 * the same OS protection (DPAPI on Windows, Keychain on macOS).
 *
 * Electron 37 exposes only the synchronous API; the async variant with key
 * rotation arrives in a later release and is a drop-in swap here when we bump.
 */

type SecretMap = Record<string, string>

let cache: SecretMap | null = null

function file() {
  return join(app.getPath('userData'), 'secrets.json')
}

function load(): SecretMap {
  if (cache) return cache
  try {
    cache = JSON.parse(readFileSync(file(), 'utf8')) as SecretMap
  } catch (err) {
    console.warn('[secrets] no secrets file yet:', (err as Error).message)
    cache = {}
  }
  return cache
}

function persist(map: SecretMap) {
  cache = map
  // Write-then-rename: a crash mid-write must not leave tokens truncated,
  // because a corrupt file means silently losing the user's connected account.
  const temp = `${file()}.tmp`
  writeFileSync(temp, JSON.stringify(map), { mode: 0o600 })
  renameSync(temp, file())
}

export function isSecureStorageAvailable(): boolean {
  return safeStorage.isEncryptionAvailable()
}

export function setSecret(key: string, value: string): void {
  if (!isSecureStorageAvailable()) {
    throw new Error('OS secure storage is unavailable; refusing to store tokens in plaintext')
  }
  persist({ ...load(), [key]: safeStorage.encryptString(value).toString('base64') })
}

export function getSecret(key: string): string | null {
  const encoded = load()[key]
  if (!encoded) return null
  try {
    return safeStorage.decryptString(Buffer.from(encoded, 'base64'))
  } catch (err) {
    // Ciphertext written under a different OS user or profile is unreadable.
    // Treat as absent so the app re-prompts rather than crashing on launch.
    console.warn('[secrets] decrypt failed:', (err as Error).message)
    return null
  }
}

export function deleteSecret(key: string): void {
  const map = { ...load() }
  delete map[key]
  persist(map)
}

export function setJson(key: string, value: unknown): void {
  setSecret(key, JSON.stringify(value))
}

export function getJson<T>(key: string): T | null {
  const raw = getSecret(key)
  if (!raw) return null
  try {
    return JSON.parse(raw) as T
  } catch (err) {
    console.warn('[secrets] json parse failed:', (err as Error).message)
    return null
  }
}
