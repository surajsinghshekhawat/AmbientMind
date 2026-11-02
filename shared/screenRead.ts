import type { FocusedContext } from './helperProtocol'

/**
 * Apps whose windows are never read, whatever the user asks. The helper
 * refuses them before touching the accessibility tree, and the app refuses
 * to fall back to a screenshot of them.
 */
export const EXCLUDED_BUNDLE_IDS = [
  'com.1password.1password',
  'com.agilebits.onepassword7',
  'com.agilebits.onepassword-osx',
  'com.bitwarden.desktop',
  'com.apple.keychainaccess',
  'com.apple.Passwords',
  'com.lastpass.LastPass',
  'com.dashlane.Dashlane',
  'com.dashlane.dashlanephonefinal',
  'org.keepassxc.keepassxc',
  'com.enpass.Enpass-Desktop'
]

/** True when the user listed the app, by name or bundle id, case-insensitively. */
export function userExcluded(
  excluded: readonly string[],
  app: { name?: string | null; bundleId?: string | null; windowTitle?: string | null }
): string | null {
  const name = app.name?.trim().toLowerCase()
  const bundleId = app.bundleId?.trim().toLowerCase()
  const title = app.windowTitle?.toLowerCase() ?? ''
  for (const entry of excluded) {
    const wanted = entry.trim().toLowerCase()
    if (!wanted) continue
    if (wanted === name || wanted === bundleId) return entry
    // Without the helper only the window title is known, which usually ends in the app's name.
    if (!name && !bundleId && title && (title === wanted || title.endsWith(` — ${wanted}`) || title.endsWith(` - ${wanted}`))) {
      return entry
    }
  }
  return null
}

/** Enough accessibility text to stand on its own, without a screenshot. */
export const AX_ENOUGH_CHARS = 200
/** Below this, a reading carries too little to make a task from. */
export const MIN_SCREEN_CHARS = 40
const MAX_SCREEN_CHARS = 6000

export type ScreenSource = 'accessibility' | 'window-ocr' | 'display-ocr'

export interface ScreenReading {
  text: string
  windowTitle: string
  source: ScreenSource
}

export function windowTitle(context: Pick<FocusedContext, 'app' | 'title'>): string {
  const parts = [context.app, context.title].filter((part): part is string => Boolean(part?.trim()))
  // Many apps title their window with their own name.
  return [...new Set(parts)].join(' — ')
}

/**
 * The accessibility reading as prompt text: the selection first, since that is
 * what the user is pointing at, then the page address, then the window text.
 */
export function focusedText(context: Pick<FocusedContext, 'text' | 'selectedText' | 'url'>): string {
  const sections: string[] = []
  const selected = context.selectedText?.trim()
  if (selected) sections.push(`Selected text:\n${selected}`)
  if (context.url) sections.push(`Address: ${context.url}`)
  const body = context.text?.trim()
  if (body) sections.push(body)
  return sections.join('\n\n').slice(0, MAX_SCREEN_CHARS)
}

/** Drops OCR lines that are too short or too garbled to carry meaning. */
export function denoiseOcr(text: string): string {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => {
      if (line.length < 3) return false
      const letters = (line.match(/\p{L}/gu) ?? []).length
      // Toolbars and icon rows OCR into punctuation soup; require real words.
      return letters / line.length > 0.5
    })
  return lines.join('\n').slice(0, MAX_SCREEN_CHARS)
}
