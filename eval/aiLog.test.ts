import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import type { AiCall } from '../electron/services/ai'
import { openAiLog, readCalls, summariseCalls } from '../electron/services/aiLog'

const call = (over: Partial<AiCall>): AiCall => ({
  at: '2026-11-01T10:00:00.000Z',
  purpose: 'extract',
  engine: 'apple',
  model: 'apple-on-device',
  ms: 1000,
  promptChars: 3000,
  ok: true,
  ...over
})

test('the budget groups by purpose and engine, timing only calls that answered', () => {
  const rows = summariseCalls([
    call({ ms: 1000 }),
    call({ ms: 2000 }),
    call({ ms: 9000 }),
    call({ ms: 50, ok: false, error: 'guardrail' }),
    call({ engine: 'ollama', model: 'qwen3:4b', ms: 4000, fellBack: true }),
    call({ purpose: 'enrich', ms: 300, promptChars: 900 })
  ])
  assert.deepEqual(
    rows.map((row) => [row.purpose, row.engine, row.calls, row.failures, row.fallbacks, row.p50, row.max]),
    [
      ['enrich', 'apple', 1, 0, 0, 300, 300],
      ['extract', 'apple', 4, 1, 0, 2000, 9000],
      ['extract', 'ollama', 1, 0, 1, 4000, 4000]
    ]
  )
})

test('the log appends lines, skips damaged ones and trims itself when large', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ai-log-'))
  try {
    const path = join(dir, 'ai-calls.jsonl')
    const record = openAiLog(path)
    record(call({ ms: 1 }))
    writeFileSync(path, `${readFileSync(path, 'utf8')}not json\n`)
    record(call({ ms: 2 }))
    assert.deepEqual(readCalls(path).map((entry) => entry.ms), [1, 2])

    writeFileSync(path, `${JSON.stringify(call({}))}\n`.repeat(8000))
    openAiLog(path)
    assert.equal(readCalls(path).length, 2000)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
