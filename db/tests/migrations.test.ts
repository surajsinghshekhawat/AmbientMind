import assert from 'node:assert/strict'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { freshStore } from './helpers'

test('every migration file is applied to a fresh database', () => {
  const db = freshStore()
  const files = readdirSync(join(process.cwd(), 'db', 'migrations')).filter((f) => f.endsWith('.sql'))
  assert.equal(db.pragma('user_version', { simple: true }), files.length)
})
