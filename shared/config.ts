import { normalizePauseAiUntil } from './pauseAi'
import { isValidAccelerator, SHORTCUT_NAMES, type ShortcutAction, type ShortcutSet } from './shortcuts'
import {
  ABOUT_ME_MAX_CHARS,
  DEFAULT_CONFIG,
  type AiEnginePreference,
  type Config,
  type OverlayCorner,
  type ThemeChoice
} from './types'

const CORNERS: OverlayCorner[] = ['top-right', 'top-left', 'bottom-right', 'bottom-left']
const ENGINES: AiEnginePreference[] = ['auto', 'apple', 'ollama']
const INTERVALS: Config['syncIntervalMinutes'][] = [5, 15, 30, 60]
const THEMES: ThemeChoice[] = ['system', 'light', 'dark']

/** Any non-finite input (NaN, Infinity, a string, null) means "use the default". */
function num(value: unknown, fallback: number, min: number, max: number, round = false): number {
  const n = typeof value === 'number' ? value : Number.NaN
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, round ? Math.round(n) : n))
}

function text(value: unknown, fallback: string, max = Infinity): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : fallback
}

/** Unknown actions and malformed keys are dropped, so the default applies. Modifier rules are the same on every OS. */
function shortcuts(value: unknown): Partial<ShortcutSet> {
  if (!value || typeof value !== 'object') return {}
  const out: Partial<ShortcutSet> = {}
  for (const action of Object.keys(SHORTCUT_NAMES) as ShortcutAction[]) {
    const accelerator = (value as Record<string, unknown>)[action]
    if (typeof accelerator === 'string' && isValidAccelerator(accelerator, 'mac')) out[action] = accelerator
  }
  return out
}

/** Trimmed, de-duplicated, capped; anything that isn't a list of strings is dropped. */
function names(value: unknown, max = 50): string[] {
  if (!Array.isArray(value)) return []
  const out: string[] = []
  for (const entry of value) {
    if (typeof entry !== 'string') continue
    const name = entry.trim().slice(0, 120)
    if (name && !out.some((kept) => kept.toLowerCase() === name.toLowerCase())) out.push(name)
  }
  return out.slice(0, max)
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

/**
 * Applied on every save and on load, so a hand-edited or corrupt file can
 * never put a NaN or a wrong type into the running app. Text is trimmed here,
 * on save, and never while the user is still typing.
 */
export function sanitizeConfig(raw: Partial<Config>): Config {
  const d = DEFAULT_CONFIG
  return {
    overlayCorner: CORNERS.includes(raw.overlayCorner as OverlayCorner)
      ? (raw.overlayCorner as OverlayCorner)
      : d.overlayCorner,
    overlayOpacity: num(raw.overlayOpacity, d.overlayOpacity, 0.4, 1),
    overlayWidth: num(raw.overlayWidth, d.overlayWidth, 280, 560, true),
    workHoursStart: num(raw.workHoursStart, d.workHoursStart, 0, 23, true),
    workHoursEnd: num(raw.workHoursEnd, d.workHoursEnd, 1, 24, true),
    syncIntervalMinutes: INTERVALS.includes(raw.syncIntervalMinutes as Config['syncIntervalMinutes'])
      ? (raw.syncIntervalMinutes as Config['syncIntervalMinutes'])
      : d.syncIntervalMinutes,
    maxTasksVisible: num(raw.maxTasksVisible, d.maxTasksVisible, 3, 20, true),
    aiEngine: ENGINES.includes(raw.aiEngine as AiEnginePreference) ? (raw.aiEngine as AiEnginePreference) : d.aiEngine,
    autoAcceptAbove: raw.autoAcceptAbove == null ? null : num(raw.autoAcceptAbove, 0.9, 0.7, 1),
    ollamaModel: text(raw.ollamaModel, d.ollamaModel) || d.ollamaModel,
    embeddingModel: text(raw.embeddingModel, d.embeddingModel) || d.embeddingModel,
    whisperModel: text(raw.whisperModel, d.whisperModel) || d.whisperModel,
    launchAtLogin: bool(raw.launchAtLogin, d.launchAtLogin),
    calendarWriteBack: bool(raw.calendarWriteBack, d.calendarWriteBack),
    appleCalendar: bool(raw.appleCalendar, d.appleCalendar),
    remindersSync: bool(raw.remindersSync, d.remindersSync),
    displayName: text(raw.displayName, '', 80),
    aboutMe: text(raw.aboutMe, '', ABOUT_ME_MAX_CHARS),
    pauseAiUntil: normalizePauseAiUntil(raw.pauseAiUntil),
    screenReading: bool(raw.screenReading, d.screenReading),
    excludedApps: names(raw.excludedApps),
    contentProtection: bool(raw.contentProtection, d.contentProtection),
    quietMode: bool(raw.quietMode, d.quietMode),
    theme: THEMES.includes(raw.theme as ThemeChoice) ? (raw.theme as ThemeChoice) : d.theme,
    shortcuts: shortcuts(raw.shortcuts),
    onboarded: bool(raw.onboarded, d.onboarded)
  }
}
