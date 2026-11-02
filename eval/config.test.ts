import assert from 'node:assert/strict'
import test from 'node:test'
import { sanitizeConfig } from '../shared/config'
import { DEFAULT_CONFIG } from '../shared/types'

test('numbers that are not numbers fall back to the defaults', () => {
  const config = sanitizeConfig({
    workHoursStart: 'nine' as never,
    workHoursEnd: Number.NaN,
    overlayOpacity: Infinity,
    maxTasksVisible: null as never,
    overlayWidth: undefined
  })
  assert.equal(config.workHoursStart, DEFAULT_CONFIG.workHoursStart)
  assert.equal(config.workHoursEnd, DEFAULT_CONFIG.workHoursEnd)
  assert.equal(config.overlayOpacity, DEFAULT_CONFIG.overlayOpacity)
  assert.equal(config.maxTasksVisible, DEFAULT_CONFIG.maxTasksVisible)
  assert.equal(config.overlayWidth, DEFAULT_CONFIG.overlayWidth)
})

test('zero is a valid hour, and out-of-range values are clamped', () => {
  const config = sanitizeConfig({ workHoursStart: 0, maxTasksVisible: 99, overlayOpacity: 0.1 })
  assert.equal(config.workHoursStart, 0)
  assert.equal(config.maxTasksVisible, 20)
  assert.equal(config.overlayOpacity, 0.4)
})

test('text is trimmed on save, and the wrong type cannot reset the whole config', () => {
  const config = sanitizeConfig({
    displayName: '  Suraj Singh  ',
    ollamaModel: 42 as never,
    aboutMe: ['not', 'text'] as never,
    overlayCorner: 'top-left'
  })
  assert.equal(config.displayName, 'Suraj Singh')
  assert.equal(config.ollamaModel, DEFAULT_CONFIG.ollamaModel)
  assert.equal(config.aboutMe, '')
  assert.equal(config.overlayCorner, 'top-left')
})

test('launch at login is off until the user turns it on', () => {
  assert.equal(DEFAULT_CONFIG.launchAtLogin, false)
  assert.equal(sanitizeConfig({}).launchAtLogin, false)
})

test('booleans must be booleans', () => {
  const config = sanitizeConfig({ calendarWriteBack: 'yes' as never, launchAtLogin: 1 as never })
  assert.equal(config.calendarWriteBack, DEFAULT_CONFIG.calendarWriteBack)
  assert.equal(config.launchAtLogin, DEFAULT_CONFIG.launchAtLogin)
})

test('theme and shortcut overrides are checked, never trusted', () => {
  const config = sanitizeConfig({
    theme: 'neon' as never,
    shortcuts: { chat: 'Control+Alt+K', quickAdd: 'Shift+A', bogus: 'Control+Alt+B' } as never
  })
  assert.equal(config.theme, 'system')
  assert.deepEqual(config.shortcuts, { chat: 'Control+Alt+K' })
  assert.deepEqual(sanitizeConfig({ shortcuts: 'nope' as never }).shortcuts, {})
  assert.equal(sanitizeConfig({ theme: 'light' }).theme, 'light')
})

test('AI engine and auto-accept only take values the app understands', () => {
  assert.equal(sanitizeConfig({}).aiEngine, 'auto')
  assert.equal(sanitizeConfig({ aiEngine: 'gpt' as never }).aiEngine, 'auto')
  assert.equal(sanitizeConfig({ aiEngine: 'apple' }).aiEngine, 'apple')
  assert.equal(sanitizeConfig({}).autoAcceptAbove, null)
  assert.equal(sanitizeConfig({ autoAcceptAbove: 0.2 }).autoAcceptAbove, 0.7)
  assert.equal(sanitizeConfig({ autoAcceptAbove: 'high' as never }).autoAcceptAbove, 0.9)
})
