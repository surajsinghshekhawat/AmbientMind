import assert from 'node:assert/strict'
import test from 'node:test'
import { createModelCache } from '../electron/services/modelCache'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

test('switching models mid-load ends up on the new model, even if the old load finishes last', async () => {
  const pending = new Map<string, ReturnType<typeof deferred<string>>>()
  const loads: string[] = []
  const cache = createModelCache((model: string) => {
    loads.push(model)
    const d = deferred<string>()
    pending.set(model, d)
    return d.promise
  }, 'tiny')

  const first = cache.get()
  cache.setModel('base')
  const second = cache.get()

  pending.get('base')!.resolve('pipe:base')
  pending.get('tiny')!.resolve('pipe:tiny')
  await Promise.allSettled([first, second])

  assert.equal(await second, 'pipe:base')
  assert.equal(await cache.get(), 'pipe:base', 'the stale load did not overwrite the new one')
  assert.deepEqual(loads, ['tiny', 'base'], 'no third load was started')
})

test('concurrent callers share one load', async () => {
  let calls = 0
  const cache = createModelCache(async (model: string) => {
    calls++
    return `pipe:${model}`
  }, 'tiny')
  const [a, b] = await Promise.all([cache.get(), cache.get()])
  assert.equal(a, 'pipe:tiny')
  assert.equal(b, 'pipe:tiny')
  assert.equal(calls, 1)
})

test('a failed load is retried on the next call', async () => {
  let attempt = 0
  const cache = createModelCache(async () => {
    attempt++
    if (attempt === 1) throw new Error('offline')
    return 'pipe'
  }, 'tiny')
  await assert.rejects(cache.get(), /offline/)
  assert.equal(await cache.get(), 'pipe')
})
