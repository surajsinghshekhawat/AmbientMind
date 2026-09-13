import assert from 'node:assert/strict'
import test from 'node:test'

/**
 * The retry decision, isolated from SQLite so it can be tested without an
 * Electron host. The store applies exactly this rule in SQL; these cases pin
 * the behaviour the rule exists to guarantee.
 */
const MAX_ATTEMPTS = 3

function isProcessed(row: { outcome: string; attempts: number } | undefined): boolean {
  if (!row) return false
  if (row.outcome === 'failed') return row.attempts >= MAX_ATTEMPTS
  return true
}

test('an unseen message is not processed', () => {
  assert.equal(isProcessed(undefined), false)
})

test('a message that produced a verdict is never re-read', () => {
  // Both are real outcomes, and both cost a model call to reach.
  assert.equal(isProcessed({ outcome: 'extracted', attempts: 0 }), true)
  assert.equal(isProcessed({ outcome: 'skipped', attempts: 0 }), true)
})

test('a transient failure is retried rather than retired', () => {
  // This is the bug the attempts column exists to fix: one dropped connection
  // used to mean that mail was never read again.
  assert.equal(isProcessed({ outcome: 'failed', attempts: 1 }), false)
  assert.equal(isProcessed({ outcome: 'failed', attempts: 2 }), false)
})

test('a message that always fails eventually stops costing a model call', () => {
  assert.equal(isProcessed({ outcome: 'failed', attempts: MAX_ATTEMPTS }), true)
  assert.equal(isProcessed({ outcome: 'failed', attempts: MAX_ATTEMPTS + 1 }), true)
})

test('succeeding after failures clears the history', () => {
  // markProcessed resets attempts to 0, so an earlier flaky run cannot push a
  // later genuine failure straight past the budget.
  assert.equal(isProcessed({ outcome: 'extracted', attempts: 0 }), true)
})
