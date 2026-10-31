import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { HelperClient } from '../electron/native/helperClient'
import { HelperError, LineDecoder, parseMessage, restartDelay } from '../shared/helperProtocol'

const FAKE = join(__dirname, 'fixtures', 'fake-helper.cjs')

function client(mode: string, extra: string[] = [], options: Partial<ConstructorParameters<typeof HelperClient>[0]> = {}) {
  return new HelperClient({
    command: process.execPath,
    args: [FAKE, mode, ...extra],
    restartDelay: () => 20,
    helloTimeoutMs: 1000,
    requestTimeoutMs: 2000,
    ...options
  })
}

// The fake answers methods the real helper does not have.
type Loose = { request: (method: string, params: unknown, options?: { timeoutMs?: number }) => Promise<unknown> }
const loose = (c: HelperClient) => c as unknown as Loose

async function rejectsWith(promise: Promise<unknown>, code: string) {
  await assert.rejects(promise, (err: unknown) => err instanceof HelperError && err.code === code)
}

test('line decoder joins split chunks and skips blank lines', () => {
  const decoder = new LineDecoder()
  assert.deepEqual(decoder.push('{"a":'), [])
  assert.deepEqual(decoder.push('1}\n\n{"b":2}\n{"c"'), ['{"a":1}', '{"b":2}'])
  assert.deepEqual(decoder.push(':3}\n'), ['{"c":3}'])
})

test('parseMessage accepts replies and events and drops anything else', () => {
  assert.deepEqual(parseMessage('{"id":1,"ok":true,"result":5}'), { id: 1, ok: true, result: 5 })
  assert.deepEqual(parseMessage('{"event":"x","data":1}'), { event: 'x', data: 1 })
  assert.deepEqual(parseMessage('{"id":2,"ok":false}'), {
    id: 2,
    ok: false,
    error: { code: 'unknown', message: 'The helper reported an error' }
  })
  assert.equal(parseMessage('not json'), null)
  assert.equal(parseMessage('[1,2]'), null)
  assert.equal(parseMessage('{"id":3}'), null)
})

test('restart delay doubles from one second up to thirty', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 20].map(restartDelay), [1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000])
})

test('handshakes, answers requests in any order, and relays errors and events', async () => {
  const helper = client('ok')
  helper.start()
  try {
    const [a, b] = await Promise.all([loose(helper).request('echo', { n: 1 }), loose(helper).request('echo', { n: 2 })])
    assert.deepEqual([a, b], [{ n: 1 }, { n: 2 }])
    assert.equal(helper.state, 'ready')
    assert.equal(helper.hello?.version, 'fake')

    await rejectsWith(loose(helper).request('fail', {}), 'permission_denied')
    await rejectsWith(loose(helper).request('nope', {}), 'unknown_method')

    const events: unknown[] = []
    helper.on('event', (name, data) => events.push([name, data]))
    assert.deepEqual(await loose(helper).request('event', {}), { done: 'ünïcødé' })
    assert.deepEqual(events, [['ping', { n: 1 }]])
  } finally {
    await helper.stop()
  }
  assert.equal(helper.state, 'stopped')
})

test('a slow answer times out without taking the helper down', async () => {
  const helper = client('ok')
  helper.start()
  try {
    await rejectsWith(loose(helper).request('slow', {}, { timeoutMs: 100 }), 'timeout')
    assert.deepEqual(await loose(helper).request('echo', { still: 'here' }), { still: 'here' })
  } finally {
    await helper.stop()
  }
})

test('a crash fails the request in flight and the helper comes back', async () => {
  const helper = client('ok')
  helper.start()
  try {
    await loose(helper).request('echo', {})
    const firstPid = helper.hello?.pid
    await rejectsWith(loose(helper).request('crash', {}), 'unavailable')
    assert.deepEqual(await loose(helper).request('echo', { back: true }), { back: true })
    assert.notEqual(helper.hello?.pid, firstPid)
  } finally {
    await helper.stop()
  }
})

test('a helper that dies at launch is retried with backoff until it stays up', async () => {
  const dir = mkdtempSync(join(__dirname, '..', '.local', 'tmp-helper-'))
  const delays: number[] = []
  const helper = client('crash-first', [join(dir, 'count')], {
    restartDelay: (failures) => {
      delays.push(failures)
      return 20
    }
  })
  helper.start()
  try {
    assert.deepEqual(await loose(helper).request('echo', { ok: 1 }), { ok: 1 })
    assert.deepEqual(delays, [1, 2])
  } finally {
    await helper.stop()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a protocol mismatch makes the helper unavailable, without retrying', async () => {
  const helper = client('protocol2')
  const exits: unknown[] = []
  helper.on('exit', (code) => exits.push(code))
  helper.start()
  await rejectsWith(loose(helper).request('echo', {}), 'unavailable')
  assert.equal(helper.state, 'unavailable')
  assert.match(helper.reason ?? '', /protocol 2/)
  await new Promise((resolve) => setTimeout(resolve, 100))
  assert.equal(exits.length, 1)
  await helper.stop()
})

test('a missing binary is unavailable straight away', async () => {
  const helper = new HelperClient({ command: join(__dirname, 'no-such-helper') })
  helper.start()
  await rejectsWith(helper.request('hello', {}), 'unavailable')
  assert.match(helper.reason ?? '', /missing/)
  await helper.stop()
})

test('a helper that never says hello is killed and restarted', async () => {
  const helper = client('mute', [], { helloTimeoutMs: 100 })
  let exits = 0
  helper.on('exit', () => (exits += 1))
  helper.start()
  await rejectsWith(loose(helper).request('echo', {}, { timeoutMs: 400 }), 'timeout')
  assert.ok(exits >= 1, 'the silent helper was killed')
  await helper.stop()
})

const REAL = join(__dirname, '..', '.local', 'build', 'mac-helper', 'release', 'ambientmind-helper')

test('the real helper handshakes and answers its methods', { skip: !existsSync(REAL) && 'helper not built' }, async () => {
  const helper = new HelperClient({ command: REAL })
  helper.start()
  try {
    const hello = await helper.request('hello', {})
    assert.equal(hello.protocol, 1)
    assert.ok(hello.features.includes('ocr'))
    const perms = await helper.request('perms.status', { kinds: ['microphone', 'accessibility'] })
    assert.deepEqual(Object.keys(perms).sort(), ['accessibility', 'microphone'])
    const busy = await helper.request('system.busy', {})
    assert.equal(typeof busy.micInUse, 'boolean')
    await rejectsWith(helper.request('capture.windowOCR', {} as { windowId: number }), 'bad_request')
  } finally {
    await helper.stop()
  }
})

test('requests before start or after stop fail fast', async () => {
  const helper = client('ok')
  await rejectsWith(helper.request('hello', {}), 'unavailable')
  helper.start()
  await loose(helper).request('echo', {})
  await helper.stop()
  await rejectsWith(helper.request('hello', {}), 'unavailable')
})
