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

test('booleans must be booleans', () => {
  const config = sanitizeConfig({ calendarWriteBack: 'yes' as never, launchAtLogin: 1 as never })
  assert.equal(config.calendarWriteBack, DEFAULT_CONFIG.calendarWriteBack)
  assert.equal(config.launchAtLogin, DEFAULT_CONFIG.launchAtLogin)
})
