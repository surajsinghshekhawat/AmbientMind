import assert from 'node:assert/strict'
import test from 'node:test'
import { BurstLimiter, guard, setErrorSink } from '../electron/services/guard'

test('a guarded handler reports a throw instead of letting it escape', () => {
  const seen: string[] = []
  setErrorSink((where, err) => seen.push(`${where}: ${(err as Error).message}`))
  const handler = guard('ipc:quick-add', (title: string) => {
    throw new Error(`bad ${title}`)
  })

  assert.doesNotThrow(() => handler('x'))
  assert.deepEqual(seen, ['ipc:quick-add: bad x'])
})

test('a guarded async handler reports a rejection', async () => {
  const seen: string[] = []
  setErrorSink((where) => seen.push(where))
  guard('timer:sweep', async () => {
    throw new Error('later')
  })()
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(seen, ['timer:sweep'])
})

test('the crash-loop limiter trips only on a burst inside the window', () => {
  const limiter = new BurstLimiter(3, 60_000)
  assert.equal(limiter.hit(0), false)
  assert.equal(limiter.hit(10_000), false)
  assert.equal(limiter.hit(65_000), false, 'the first hit has aged out')
  assert.equal(limiter.hit(66_000), true)
})
