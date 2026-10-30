import assert from 'node:assert/strict'
import test from 'node:test'
import { unwrapBackup, wrapBackup } from '../shared/backupCrypto'

test('a wrapped buffer round-trips with the same passphrase', () => {
  const plain = Buffer.from('hello ambientmind')
  const blob = wrapBackup(plain, 'correct-horse')
  assert.equal(unwrapBackup(blob, 'correct-horse').toString(), 'hello ambientmind')
})

test('the wrong passphrase is rejected rather than returning garbage', () => {
  const blob = wrapBackup(Buffer.from('secret-db'), 'correct-horse')
  assert.throws(() => unwrapBackup(blob, 'wrong-passphrase-1'))
})

test('a short passphrase is refused', () => {
  assert.throws(() => wrapBackup(Buffer.from('x'), 'short'))
})

test('the file starts with the documented magic', () => {
  const blob = wrapBackup(Buffer.from('x'.repeat(32)), 'correct-horse')
  assert.equal(blob.subarray(0, 5).toString(), 'AMBK1')
})
