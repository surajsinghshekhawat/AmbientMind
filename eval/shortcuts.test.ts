import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  acceleratorFromKey,
  defaultShortcuts,
  findConflicts,
  isValidAccelerator,
  macHotkey,
  resolveShortcuts,
  sameShortcut,
  shortcutLabel,
  type KeyPress
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

const press = (code: string, mods: Partial<KeyPress> = {}): KeyPress => ({
  code,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...mods
})

test('the recorder reads physical keys, so Option+S is S and not ß', () => {
  assert.deepEqual(acceleratorFromKey(press('KeyS', { ctrlKey: true, altKey: true }), 'mac'), {
    accelerator: 'Control+Alt+S'
  })
  assert.deepEqual(acceleratorFromKey(press('Space', { metaKey: true, shiftKey: true }), 'mac'), {
    accelerator: 'Shift+Command+Space'
  })
  assert.deepEqual(acceleratorFromKey(press('Comma', { ctrlKey: true, metaKey: true }), 'win'), {
    accelerator: 'Control+Super+,'
  })
  assert.deepEqual(acceleratorFromKey(press('F5'), 'mac'), { accelerator: 'F5' })
})

test('the recorder waits through modifiers and refuses weak or odd keys', () => {
  assert.equal(acceleratorFromKey(press('AltLeft', { altKey: true }), 'mac'), null)
  assert.equal(acceleratorFromKey(press('MetaRight', { metaKey: true }), 'mac'), null)
  assert.ok('error' in acceleratorFromKey(press('KeyA'), 'mac')!)
  assert.ok('error' in acceleratorFromKey(press('KeyA', { shiftKey: true }), 'mac')!)
  assert.ok('error' in acceleratorFromKey(press('Enter', { ctrlKey: true }), 'mac')!)
})

test('recorded shortcuts round-trip through validation and labels', () => {
  const recorded = acceleratorFromKey(press('KeyK', { ctrlKey: true, altKey: true, metaKey: true }), 'mac')
  assert.ok(recorded && 'accelerator' in recorded)
  assert.equal(isValidAccelerator(recorded.accelerator, 'mac'), true)
  assert.equal(shortcutLabel(recorded.accelerator, 'mac'), '⌃⌥⌘K')
  assert.equal(isValidAccelerator('Shift+A', 'mac'), false)
  assert.equal(isValidAccelerator('Control+Banana', 'mac'), false)
  assert.equal(isValidAccelerator('', 'mac'), false)
})

test('overrides replace only the shortcuts the user changed', () => {
  const set = resolveShortcuts('mac', { chat: 'Control+Alt+K' })
  assert.equal(set.chat, 'Control+Alt+K')
  assert.equal(set.quickAdd, defaultShortcuts('mac').quickAdd)
})

test('Mac shortcuts become Carbon hotkeys by physical key', () => {
  assert.deepEqual(macHotkey('Control+Alt+Space'), { keyCode: 49, modifiers: 0x1000 | 0x800 })
  assert.deepEqual(macHotkey('Command+Shift+K'), { keyCode: 40, modifiers: 0x100 | 0x200 })
  assert.deepEqual(macHotkey('CmdOrCtrl+,'), { keyCode: 43, modifiers: 0x100 })
  assert.deepEqual(macHotkey('F5'), { keyCode: 96, modifiers: 0 })
  assert.deepEqual(macHotkey('Control+Alt+Up'), { keyCode: 126, modifiers: 0x1800 })
  assert.equal(macHotkey('F24'), null)
  assert.equal(macHotkey('Shift+A'), null)
  for (const accelerator of Object.values(defaultShortcuts('mac'))) assert.ok(macHotkey(accelerator), accelerator)
})
