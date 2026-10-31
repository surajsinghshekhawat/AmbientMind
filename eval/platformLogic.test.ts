import { test } from 'node:test'
import assert from 'node:assert/strict'
import { overlayBounds } from '../shared/overlayGeometry'
import { DockPresence } from '../electron/platform/dockPresence'
import { permissionHelp, privacySettingsUrl } from '../shared/permissions'

const secondDisplay = { x: 1512, y: 25, width: 1920, height: 1055 }

test('the collapsed orb sits in its corner of the given display', () => {
  const topRight = overlayBounds({ workArea: secondDisplay, corner: 'top-right', width: 380, expanded: false })
  assert.deepEqual(topRight, { x: 1512 + 1920 - 70 - 24, y: 25 + 24, width: 70, height: 70 })

  const bottomLeft = overlayBounds({ workArea: secondDisplay, corner: 'bottom-left', width: 380, expanded: false })
  assert.deepEqual(bottomLeft, { x: 1512 + 24, y: 25 + 1055 - 70 - 24, width: 70, height: 70 })
})

test('the expanded panel stays on the same display and inside its work area', () => {
  const bounds = overlayBounds({ workArea: secondDisplay, corner: 'bottom-right', width: 380, expanded: true })
  assert.equal(bounds.width, 380)
  assert.ok(bounds.x >= secondDisplay.x)
  assert.ok(bounds.x + bounds.width <= secondDisplay.x + secondDisplay.width)
  assert.ok(bounds.y >= secondDisplay.y)
  assert.ok(bounds.y + bounds.height <= secondDisplay.y + secondDisplay.height)
})

test('a panel wider than a small display is clamped to it', () => {
  const small = { x: 0, y: 0, width: 300, height: 500 }
  const bounds = overlayBounds({ workArea: small, corner: 'top-left', width: 380, expanded: true })
  assert.ok(bounds.width <= 300 - 48)
  assert.ok(bounds.x >= 0)
})

test('the Dock icon shows while any window needs it and hides after the last closes', () => {
  const calls: string[] = []
  let now = 0
  const dock = new DockPresence({
    show: () => calls.push('show'),
    hide: () => calls.push('hide'),
    now: () => (now += 5_000)
  })

  dock.open('settings')
  dock.open('chat')
  dock.open('settings')
  assert.deepEqual(calls, ['show'])

  dock.close('settings')
  assert.deepEqual(calls, ['show'])
  dock.close('chat')
  assert.deepEqual(calls, ['show', 'hide'])

  dock.close('chat')
  assert.deepEqual(calls, ['show', 'hide'])
})

test('a window closed right after opening still takes the Dock icon with it', () => {
  // Electron ignores dock.hide() within a second of dock.show().
  let now = 0
  const pending: { at: number; fn: () => void }[] = []
  const calls: string[] = []
  const dock = new DockPresence({
    show: () => calls.push('show'),
    hide: () => calls.push('hide'),
    now: () => now,
    later: (fn, ms) => pending.push({ at: now + ms, fn })
  })

  dock.open('settings')
  now = 300
  dock.close('settings')
  assert.deepEqual(calls, ['show'])

  now = pending[0]!.at
  pending.shift()!.fn()
  assert.deepEqual(calls, ['show', 'hide'])
})

test('reopening before a delayed hide keeps the Dock icon', () => {
  let now = 0
  const pending: (() => void)[] = []
  const calls: string[] = []
  const dock = new DockPresence({
    show: () => calls.push('show'),
    hide: () => calls.push('hide'),
    now: () => now,
    later: (fn) => pending.push(fn)
  })

  dock.open('settings')
  dock.close('settings')
  dock.open('chat')
  pending.forEach((fn) => fn())
  assert.deepEqual(calls, ['show'])
})

test('privacy settings links point at the right pane', () => {
  assert.match(privacySettingsUrl('screen', 'mac') ?? '', /Privacy_ScreenCapture$/)
  assert.match(privacySettingsUrl('microphone', 'mac') ?? '', /Privacy_Microphone$/)
  assert.equal(privacySettingsUrl('microphone', 'win'), 'ms-settings:privacy-microphone')
  assert.equal(privacySettingsUrl('screen', 'win'), null)
})

test('permission help names the setting only when something is wrong', () => {
  assert.equal(permissionHelp('screen', 'granted', 'mac'), null)
  // macOS asks on first use; nothing to explain yet.
  assert.equal(permissionHelp('microphone', 'not-determined', 'mac'), null)
  assert.match(permissionHelp('screen', 'denied', 'mac') ?? '', /Screen & System Audio Recording/)
  assert.match(permissionHelp('microphone', 'denied', 'mac') ?? '', /Privacy & Security → Microphone/)
  assert.match(permissionHelp('microphone', 'restricted', 'mac') ?? '', /managed|administrator/i)
  assert.match(permissionHelp('microphone', 'denied', 'win') ?? '', /Privacy & security → Microphone/)
})
