import assert from 'node:assert/strict'
import test from 'node:test'
import { EXAMPLE_TEXT_CHARS, renderFewShot, truncateExample } from '../electron/services/vectorStore'
import { KEEP_DECISIONS, KEEP_EXAMPLES, KEEP_PROCESSED_DAYS } from '../shared/retention'

/**
 * Mirrors the SQL in pruneExamples: newest `keep` rows survive; among the
 * rest, only unrated rows are evicted. Rated examples are the only
 * supervision the store has.
 */
function doomedExampleIds(
  rows: { id: number; feedback: number; created_at: string }[],
  keep: number
): number[] {
  const newest = [...rows]
    .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id)
    .slice(0, keep)
  const kept = new Set(newest.map((row) => row.id))
  return rows.filter((row) => row.feedback === 0 && !kept.has(row.id)).map((row) => row.id)
}

test('retention caps are the ones the sweep actually uses', () => {
  assert.equal(KEEP_EXAMPLES, 2000)
  assert.equal(KEEP_PROCESSED_DAYS, 90)
  assert.equal(KEEP_DECISIONS, 5000)
})

test('prune drops oldest unrated rows past the cap', () => {
  const rows = [
    { id: 1, feedback: 0, created_at: '2026-01-01T00:00:00.000Z' },
    { id: 2, feedback: 0, created_at: '2026-02-01T00:00:00.000Z' },
    { id: 3, feedback: 0, created_at: '2026-03-01T00:00:00.000Z' }
  ]
  assert.deepEqual(doomedExampleIds(rows, 2), [1])
})

test('rated examples are never evicted, even if they are the oldest', () => {
  const rows = [
    { id: 1, feedback: 1, created_at: '2026-01-01T00:00:00.000Z' },
    { id: 2, feedback: -1, created_at: '2026-01-02T00:00:00.000Z' },
    { id: 3, feedback: 0, created_at: '2026-03-01T00:00:00.000Z' }
  ]
  assert.deepEqual(doomedExampleIds(rows, 1), [])
})

test('under the cap, nothing is deleted', () => {
  const rows = [
    { id: 1, feedback: 0, created_at: '2026-01-01T00:00:00.000Z' },
    { id: 2, feedback: 0, created_at: '2026-02-01T00:00:00.000Z' }
  ]
  assert.deepEqual(doomedExampleIds(rows, 10), [])
})

test('truncated text keeps the opening, which is what retrieval uses', () => {
  const text = `Subject: Q1 volumes\nFrom: louise@enron.com\n\n${'x'.repeat(EXAMPLE_TEXT_CHARS)}`
  const cut = truncateExample(text)
  assert.ok(cut.startsWith('Subject: Q1 volumes'))
  assert.ok(cut.length <= EXAMPLE_TEXT_CHARS + 1)
})

test('a thumbs-down example is replayed as an empty extraction', () => {
  const block = renderFewShot([
    {
      id: 1,
      message: 'Can you send the Q1 numbers by Friday',
      tasks: [{ title: 'Send Q1 numbers', deadline: null, priority: 'high', people: [], confidence: 0.9 }],
      feedback: -1,
      distance: 0.1
    }
  ])
  assert.match(block, /Can you send the Q1 numbers/)
  assert.match(block, /"tasks":\[\]/)
  assert.doesNotMatch(block, /Send Q1 numbers/)
})

test('an unrated example still shows what was extracted', () => {
  const block = renderFewShot([
    {
      id: 1,
      message: 'Please review the ISDA by EOD',
      tasks: [{ title: 'Review ISDA', deadline: null, priority: 'high', people: [], confidence: 0.8 }],
      feedback: 0,
      distance: 0.2
    }
  ])
  assert.match(block, /Review ISDA/)
})
