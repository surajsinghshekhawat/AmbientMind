import assert from 'node:assert/strict'
import { afterEach, beforeEach, test } from 'node:test'
import { HelperError, type AppleModelStatus } from '../shared/helperProtocol'
import { AiUnavailableError, configureAi, fitsApple, generate, type AiCall, type AppleBackend } from '../electron/services/ai'

interface FakeOllama {
  up: boolean
  chats: number
}

let ollama: FakeOllama
let calls: AiCall[]
let restoreFetch: () => void

function fakeFetch() {
  const original = globalThis.fetch
  globalThis.fetch = (async (url: string) => {
    if (!ollama.up) throw new TypeError('fetch failed')
    if (String(url).endsWith('/api/tags')) return new Response(JSON.stringify({ models: [] }))
    ollama.chats++
    return new Response(JSON.stringify({ message: { content: '{"from":"ollama"}' } }))
  }) as typeof fetch
  return () => {
    globalThis.fetch = original
  }
}

function apple(status: Partial<AppleModelStatus>, answer: () => Promise<string> = async () => '{"from":"apple"}'): AppleBackend & { generated: number } {
  const backend = {
    generated: 0,
    status: async () => ({ available: true, reason: null, contextTokens: 4096, ...status }),
    generate: async () => {
      backend.generated++
      return { content: await answer(), ms: 5 }
    }
  }
  return backend
}

const REQUEST = { purpose: 'extract' as const, system: 'Extract tasks.', user: 'Please send the deck.', schema: { type: 'object' } }

beforeEach(() => {
  ollama = { up: true, chats: 0 }
  calls = []
  restoreFetch = fakeFetch()
  configureAi({ preference: 'auto', ollamaModel: 'qwen3:4b', onCall: (call) => calls.push(call) })
})

afterEach(() => restoreFetch())

test('automatic uses Apple when this Mac has it', async () => {
  const backend = apple({})
  configureAi({ apple: backend })
  const result = await generate(REQUEST)
  assert.equal(result.engine, 'apple')
  assert.equal(result.content, '{"from":"apple"}')
  assert.equal(ollama.chats, 0)
  assert.equal(calls[0]?.engine, 'apple')
  assert.equal(calls[0]?.ok, true)
})

test('automatic uses Ollama when Apple Intelligence is off', async () => {
  configureAi({ apple: apple({ available: false, reason: 'not_enabled' }) })
  const result = await generate(REQUEST)
  assert.equal(result.engine, 'ollama')
  assert.equal(result.model, 'qwen3:4b')
})

test('choosing Ollama skips Apple even when it is there', async () => {
  const backend = apple({})
  configureAi({ apple: backend, preference: 'ollama' })
  assert.equal((await generate(REQUEST)).engine, 'ollama')
  assert.equal(backend.generated, 0)
})

test('an Apple refusal falls back to Ollama and is logged as such', async () => {
  configureAi({ apple: apple({}, async () => Promise.reject(new HelperError('guardrail', 'declined'))) })
  const result = await generate(REQUEST)
  assert.equal(result.engine, 'ollama')
  assert.deepEqual(
    calls.map((call) => [call.engine, call.ok, call.fellBack ?? false]),
    [
      ['apple', false, false],
      ['ollama', true, true]
    ]
  )
  assert.equal(calls[0]?.error, 'guardrail')
})

test('Apple only means no fallback', async () => {
  configureAi({ apple: apple({}, async () => Promise.reject(new HelperError('guardrail', 'declined'))), preference: 'apple' })
  await assert.rejects(generate(REQUEST), (err: Error) => (err as HelperError).code === 'guardrail')
  assert.equal(ollama.chats, 0)
})

test('a prompt too long for Apple goes to Ollama whole', async () => {
  const backend = apple({})
  configureAi({ apple: backend })
  const result = await generate({ ...REQUEST, user: 'word '.repeat(4000) })
  assert.equal(result.engine, 'ollama')
  assert.equal(backend.generated, 0)
  assert.equal(calls[0]?.fellBack, true)
})

test('with neither engine the call says so instead of hanging', async () => {
  ollama.up = false
  configureAi({ apple: apple({ available: false, reason: 'not_enabled' }) })
  await assert.rejects(generate(REQUEST), AiUnavailableError)
})

test('the Apple budget leaves room for the answer', () => {
  assert.equal(fitsApple('s'.repeat(3000), 'u'.repeat(3000), null, 800), true)
  assert.equal(fitsApple('s'.repeat(3000), 'u'.repeat(9000), null, 800), false)
})
