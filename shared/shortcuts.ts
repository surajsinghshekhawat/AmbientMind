/**
 * Global shortcut defaults, labels and conflict checks. Pure, so Settings and
 * main agree on what a shortcut is called and the rules are testable.
 */

export type Os = 'mac' | 'win' | 'linux'

export type ShortcutAction = 'quickAdd' | 'capture' | 'chat' | 'settings'

export type ShortcutSet = Record<ShortcutAction, string>

export interface ShortcutStatus {
  action: ShortcutAction
  name: string
  accelerator: string
  label: string
  /** Why it may not work: a known conflict, or another app holding the keys. */
  problem: string | null
}

export const SHORTCUT_NAMES: Record<ShortcutAction, string> = {
  quickAdd: 'Quick add',
  capture: 'Capture screen',
  chat: 'Ask about your tasks',
  settings: 'Open settings'
}

/**
 * On the Mac, ⌘⇧ combinations belong to the frontmost app (⌘⇧S is Save As
 * nearly everywhere), so global shortcuts live on ⌃⌥, which apps rarely use.
 */
export function defaultShortcuts(os: Os): ShortcutSet {
  if (os === 'mac') {
    return {
      quickAdd: 'Control+Alt+Space',
      capture: 'Control+Alt+S',
      chat: 'Control+Alt+C',
      settings: 'Control+Alt+,'
    }
  }
  return {
    quickAdd: 'Control+Shift+A',
    capture: 'Control+Shift+S',
    chat: 'Control+Shift+C',
    settings: 'Control+Shift+,'
  }
}

type Modifier = 'control' | 'alt' | 'shift' | 'command' | 'super'

const MODIFIER_ALIASES: Record<string, Modifier | 'commandorcontrol'> = {
  control: 'control',
  ctrl: 'control',
  alt: 'alt',
  option: 'alt',
  altgr: 'alt',
  shift: 'shift',
  command: 'command',
  cmd: 'command',
  super: 'super',
  meta: 'super',
  commandorcontrol: 'commandorcontrol',
  cmdorctrl: 'commandorcontrol'
}

interface Parsed {
  modifiers: Set<Modifier>
  key: string
}

function parse(accelerator: string, os: Os): Parsed {
  const modifiers = new Set<Modifier>()
  let key = ''
  for (const raw of accelerator.split('+').map((part) => part.trim())) {
    const alias = MODIFIER_ALIASES[raw.toLowerCase()]
    if (alias === 'commandorcontrol') modifiers.add(os === 'mac' ? 'command' : 'control')
    // On the Mac, Super is the Command key.
    else if (alias === 'super' && os === 'mac') modifiers.add('command')
    else if (alias) modifiers.add(alias)
    else key = raw.length === 1 ? raw.toUpperCase() : raw[0]!.toUpperCase() + raw.slice(1)
  }
  return { modifiers, key }
}

function canonical(accelerator: string, os: Os): string {
  const { modifiers, key } = parse(accelerator, os)
  return [...[...modifiers].sort(), key].join('+')
}

export function sameShortcut(a: string, b: string, os: Os): boolean {
  return canonical(a, os) === canonical(b, os)
}

const MAC_GLYPHS: [Modifier, string][] = [
  ['control', '⌃'],
  ['alt', '⌥'],
  ['shift', '⇧'],
  ['command', '⌘']
]

const WIN_NAMES: [Modifier, string][] = [
  ['control', 'Ctrl'],
  ['super', 'Win'],
  ['alt', 'Alt'],
  ['shift', 'Shift']
]

export function shortcutLabel(accelerator: string, os: Os): string {
  const { modifiers, key } = parse(accelerator, os)
  if (os === 'mac') {
    return MAC_GLYPHS.filter(([mod]) => modifiers.has(mod)).map(([, glyph]) => glyph).join('') + key
  }
  return [...WIN_NAMES.filter(([mod]) => modifiers.has(mod)).map(([, name]) => name), key].join('+')
}

/** Shortcuts the system or nearly every app already owns. */
const RESERVED: Record<Os, [string, string][]> = {
  mac: [
    ['Command+Space', 'Spotlight'],
    ['Command+Alt+Space', 'Finder search'],
    ['Control+Space', 'switching keyboard input source'],
    ['Command+Tab', 'the app switcher'],
    ['Command+Shift+S', 'Save As in most apps'],
    ['Command+Shift+A', 'Finder and Chrome'],
    ['Command+Shift+C', 'Finder and Chrome'],
    ['Command+Shift+3', 'screenshots'],
    ['Command+Shift+4', 'screenshots'],
    ['Command+Shift+5', 'screenshots'],
    ['Control+Up', 'Mission Control'],
    ['Control+Down', 'App Exposé'],
    ['Command+Control+Q', 'Lock Screen']
  ],
  win: [
    ['Super+Shift+S', 'the Snipping Tool'],
    ['Control+Shift+Escape', 'Task Manager'],
    ['Control+Alt+Delete', 'the security screen'],
    ['Alt+Tab', 'the app switcher'],
    ['Super+L', 'Lock'],
    ['Super+Space', 'switching keyboard layout']
  ],
  linux: []
}

/** Action -> reason, only for shortcuts that have a problem. */
export function findConflicts(set: ShortcutSet, os: Os): Partial<Record<ShortcutAction, string>> {
  const conflicts: Partial<Record<ShortcutAction, string>> = {}
  const seen: [ShortcutAction, string][] = []
  for (const [action, accelerator] of Object.entries(set) as [ShortcutAction, string][]) {
    const reserved = RESERVED[os].find(([keys]) => sameShortcut(keys, accelerator, os))
    const duplicate = seen.find(([, other]) => sameShortcut(other, accelerator, os))
    if (reserved) conflicts[action] = `Already used by ${reserved[1]}`
    else if (duplicate) conflicts[action] = `Same keys as ${SHORTCUT_NAMES[duplicate[0]]}`
    seen.push([action, accelerator])
  }
  return conflicts
}

export function resolveShortcuts(os: Os, overrides: Partial<ShortcutSet> = {}): ShortcutSet {
  return { ...defaultShortcuts(os), ...overrides }
}

/** What a recorder sees of a keydown; a plain object so it is testable. */
export interface KeyPress {
  code: string
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
}

const PUNCTUATION: Record<string, string> = {
  Comma: ',',
  Period: '.',
  Slash: '/',
  Semicolon: ';',
  Quote: "'",
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Minus: '-',
  Equal: '=',
  Backquote: '`'
}

const NAMED: Record<string, string> = {
  Space: 'Space',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown'
}

/**
 * From the physical key, not the character: on the Mac ⌥S types ß, and a
 * shortcut has to mean the same keys on any layout.
 */
function keyFromCode(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3)
  if (/^Digit[0-9]$/.test(code)) return code.slice(5)
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code
  return PUNCTUATION[code] ?? NAMED[code] ?? null
}

const KEY_NAMES = new Set([...Object.values(PUNCTUATION), ...Object.values(NAMED)])

function isKey(key: string): boolean {
  return /^[A-Z0-9]$/.test(key) || /^F([1-9]|1[0-9]|2[0-4])$/.test(key) || KEY_NAMES.has(key)
}

/** A global shortcut needs ⌃, ⌥ or ⌘ (Ctrl, Alt or Win), or a function key; Shift alone would eat typing. */
function strongEnough(modifiers: Set<Modifier>, key: string): boolean {
  if (/^F\d+$/.test(key)) return true
  return modifiers.has('control') || modifiers.has('alt') || modifiers.has('command') || modifiers.has('super')
}

export function isValidAccelerator(accelerator: string, os: Os): boolean {
  if (typeof accelerator !== 'string' || !accelerator.trim()) return false
  const { modifiers, key } = parse(accelerator, os)
  return isKey(key) && strongEnough(modifiers, key)
}

export type Recorded = { accelerator: string } | { error: string } | null

/** Null while only modifiers are held: the recorder keeps listening. */
export function acceleratorFromKey(press: KeyPress, os: Os): Recorded {
  if (/^(Shift|Control|Alt|Meta|OS)(Left|Right)?$/.test(press.code)) return null
  const key = keyFromCode(press.code)
  if (!key) return { error: 'That key cannot be part of a shortcut' }
  const parts: string[] = []
  if (press.ctrlKey) parts.push('Control')
  if (press.altKey) parts.push('Alt')
  if (press.shiftKey) parts.push('Shift')
  if (press.metaKey) parts.push(os === 'mac' ? 'Command' : 'Super')
  const accelerator = [...parts, key].join('+')
  if (!isValidAccelerator(accelerator, os)) {
    return { error: os === 'mac' ? 'Add ⌃, ⌥ or ⌘ to the key' : 'Add Ctrl, Alt or Win to the key' }
  }
  return { accelerator }
}
