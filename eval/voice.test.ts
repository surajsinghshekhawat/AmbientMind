import assert from 'node:assert/strict'
import test from 'node:test'
import { HoldGesture, type HoldActions } from '../electron/holdGesture'
import { SilenceGate } from '../shared/silence'

function harness(open = false) {
  const calls: string[] = []
  let pending: (() => void) | null = null
  const actions: HoldActions = {
    isOpen: () => open,
    open: () => {
      open = true
      calls.push('open')
    },
    toggleMic: () => calls.push('toggle'),
    holdStart: () => calls.push('holdStart'),
    holdEnd: () => calls.push('holdEnd')
  }
  const gesture = new HoldGesture(actions, 300, {
    set: ((fn: () => void) => {
      pending = fn
      return 1 as unknown as ReturnType<typeof setTimeout>
    }) as unknown as typeof setTimeout,
    clear: (() => (pending = null)) as unknown as typeof clearTimeout
  })
  const elapse = () => {
    const fn = pending
    pending = null
    fn?.()
  }
  return { gesture, calls, elapse }
}

test('a tap opens Quick Capture and nothing else', () => {
  const { gesture, calls } = harness()
  gesture.down()
  gesture.up()
  assert.deepEqual(calls, ['open'])
})

test('a tap while open toggles the mic', () => {
  const { gesture, calls } = harness(true)
  gesture.down()
  gesture.up()
  assert.deepEqual(calls, ['toggle'])
})

test('holding talks while held, from closed or open', () => {
  const closed = harness()
  closed.gesture.down()
  closed.elapse()
  closed.gesture.up()
  assert.deepEqual(closed.calls, ['open', 'holdStart', 'holdEnd'])

  const open = harness(true)
  open.gesture.down()
  open.elapse()
  open.gesture.up()
  assert.deepEqual(open.calls, ['holdStart', 'holdEnd'])
})

test('key repeat and stray releases are ignored', () => {
  const { gesture, calls, elapse } = harness()
  gesture.up()
  gesture.down()
  gesture.down()
  elapse()
  gesture.up()
  gesture.up()
  assert.deepEqual(calls, ['open', 'holdStart', 'holdEnd'])
})

test('losing the hotkey mid-hold still ends the recording', () => {
  const { gesture, calls, elapse } = harness()
  gesture.down()
  elapse()
  gesture.reset()
  gesture.up()
  assert.deepEqual(calls, ['open', 'holdStart', 'holdEnd'])
})

test('silence ends a recording only after speech, and only once', () => {
  const gate = new SilenceGate({ silenceMs: 1000, warmupMs: 400, maxMs: 25_000 })
  assert.equal(gate.push(0.5, 0), false, 'the opening spike is ignored')
  assert.equal(gate.push(0.001, 2000), false, 'silence before speech keeps listening')
  assert.equal(gate.push(0.05, 2100), false)
  assert.equal(gate.push(0.001, 2600), false)
  assert.equal(gate.push(0.001, 3100), true)
  assert.equal(gate.push(0.001, 4000), false)
})

test('a recording stops at the length limit even mid-speech', () => {
  const gate = new SilenceGate({ silenceMs: 1000, maxMs: 5000 })
  assert.equal(gate.push(0.2, 0), false)
  assert.equal(gate.push(0.2, 4999), false)
  assert.equal(gate.push(0.2, 5000), true)
})
