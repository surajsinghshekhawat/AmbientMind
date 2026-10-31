import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  defaultShortcuts,
  findConflicts,
  sameShortcut,
  shortcutLabel
} from '../shared/shortcuts'

test('mac defaults sit on Control+Option, clear of Command shortcuts', () => {
  const mac = defaultShortcuts('mac')
  assert.equal(mac.quickAdd, 'Control+Alt+Space')
  for (const accelerator of Object.values(mac)) {
    assert.match(accelerator, /^Control\+Alt\+/)
    assert.doesNotMatch(accelerator, /Command|CommandOrControl/)
  }
})

test('windows keeps the Ctrl+Shift shortcuts people already know', () => {
  const win = defaultShortcuts('win')
  assert.equal(win.quickAdd, 'Control+Shift+A')
  assert.equal(win.capture, 'Control+Shift+S')
  assert.equal(win.chat, 'Control+Shift+C')
  assert.equal(win.settings, 'Control+Shift+,')
})

test('mac labels use glyphs in Apple order: control, option, shift, command', () => {
  assert.equal(shortcutLabel('Control+Alt+Space', 'mac'), '⌃⌥Space')
  assert.equal(shortcutLabel('Shift+Alt+Control+s', 'mac'), '⌃⌥⇧S')
  assert.equal(shortcutLabel('CommandOrControl+Shift+,', 'mac'), '⇧⌘,')
  assert.equal(shortcutLabel('Cmd+Option+K', 'mac'), '⌥⌘K')
})

test('windows labels are spelled out', () => {
  assert.equal(shortcutLabel('Control+Shift+A', 'win'), 'Ctrl+Shift+A')
  assert.equal(shortcutLabel('CommandOrControl+Alt+Space', 'win'), 'Ctrl+Alt+Space')
  assert.equal(shortcutLabel('Super+Shift+S', 'win'), 'Win+Shift+S')
})

test('the same keys written differently are the same shortcut', () => {
  assert.ok(sameShortcut('Ctrl+Option+S', 'Alt+Control+s', 'mac'))
  assert.ok(sameShortcut('CommandOrControl+Shift+S', 'Cmd+Shift+S', 'mac'))
  assert.ok(sameShortcut('CommandOrControl+Shift+S', 'Control+Shift+S', 'win'))
  assert.ok(!sameShortcut('Control+Shift+S', 'Control+Alt+S', 'mac'))
})

test('defaults have no conflicts on either platform', () => {
  for (const os of ['mac', 'win'] as const) {
    const conflicts = findConflicts(defaultShortcuts(os), os)
    assert.deepEqual(conflicts, {}, os)
  }
})

test('flags shortcuts that macOS or common apps already own', () => {
  const conflicts = findConflicts(
    { quickAdd: 'Command+Space', capture: 'Command+Shift+S', chat: 'Control+Alt+C', settings: 'Control+Alt+,' },
    'mac'
  )
  assert.match(conflicts.quickAdd ?? '', /Spotlight/)
  assert.match(conflicts.capture ?? '', /Save As/)
  assert.equal(conflicts.chat, undefined)
})

test('flags two actions bound to the same keys', () => {
  const conflicts = findConflicts(
    { quickAdd: 'Control+Alt+S', capture: 'Alt+Control+S', chat: 'Control+Alt+C', settings: 'Control+Alt+,' },
    'mac'
  )
  assert.match(conflicts.capture ?? '', /Quick add/)
})

test('flags Windows system shortcuts', () => {
  const conflicts = findConflicts(
    { quickAdd: 'Super+Shift+S', capture: 'Control+Shift+Escape', chat: 'Control+Shift+C', settings: 'Control+Shift+,' },
    'win'
  )
  assert.match(conflicts.quickAdd ?? '', /Snipping/)
  assert.match(conflicts.capture ?? '', /Task Manager/)
})
