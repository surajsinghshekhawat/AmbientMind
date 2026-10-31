import assert from 'node:assert/strict'
import test from 'node:test'
import { enrichTask, listModels } from '../electron/services/ollama'

/** A server that accepts the connection and never answers. */
function hangingFetch(): () => void {
  const original = globalThis.fetch
  globalThis.fetch = ((_url: string, init?: RequestInit) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal!.reason))
    })) as typeof fetch
  return () => {
    globalThis.fetch = original
  }
}

test('listing models gives up instead of hanging the health check', async () => {
  const restore = hangingFetch()
  try {
    const started = Date.now()
    await assert.rejects(listModels({ timeoutMs: 50 }))
    assert.ok(Date.now() - started < 1000)
  } finally {
    restore()
  }
})

test('quick-add enrichment falls back to the typed text when the model stalls', async () => {
  const restore = hangingFetch()
  try {
    const enriched = await enrichTask('call sam', { timeoutMs: 50 })
    assert.equal(enriched.title, 'call sam')
    assert.equal(enriched.deadline, null)
  } finally {
    restore()
  }
})
