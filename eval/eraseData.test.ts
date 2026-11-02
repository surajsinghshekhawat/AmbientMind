import assert from 'node:assert/strict'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { eraseUserData } from '../electron/services/eraseData'

const root = join(process.cwd(), '.local', 'tmp')
mkdirSync(root, { recursive: true })
const dir = mkdtempSync(join(root, 'erase-'))
after(() => rmSync(dir, { recursive: true, force: true }))

test('erasing empties the data folder but keeps the Google client file', () => {
  const data = join(dir, 'data')
  const logs = join(dir, 'logs')
  mkdirSync(join(data, 'whisper', 'models'), { recursive: true })
  mkdirSync(logs)
  for (const name of ['ambientmind.db', 'ambientmind.db-wal', 'config.json', 'secrets.json', 'chat-history.json', 'google-credentials.json']) {
    writeFileSync(join(data, name), 'x')
  }
  writeFileSync(join(data, 'whisper', 'models', 'model.onnx'), 'x')
  writeFileSync(join(logs, 'crash.log'), 'x')

  assert.deepEqual(eraseUserData(data, join(logs, 'crash.log')), [])

  assert.deepEqual(readdirSync(data), ['google-credentials.json'])
  assert.equal(existsSync(join(logs, 'crash.log')), false)
})

test('erasing a folder that is already gone does nothing', () => {
  assert.deepEqual(eraseUserData(join(dir, 'missing'), join(dir, 'missing.log')), [])
})

test('what cannot be removed is reported, not thrown, and the rest still goes', { skip: process.platform === 'win32' }, () => {
  const data = join(dir, 'locked-data')
  const locked = join(data, 'session')
  mkdirSync(locked, { recursive: true })
  writeFileSync(join(locked, 'Cookies'), 'x')
  writeFileSync(join(data, 'ambientmind.db'), 'x')
  // A folder whose entries can't be unlinked stands in for Windows' open-file lock.
  chmodSync(locked, 0o500)
  try {
    assert.deepEqual(eraseUserData(data, join(dir, 'no.log')), [locked])
    assert.equal(existsSync(join(data, 'ambientmind.db')), false)
  } finally {
    chmodSync(locked, 0o700)
  }
})
