import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { ABOUT_ME_MAX_CHARS, DEFAULT_CONFIG, type Config, type OverlayCorner } from '@shared/types'

const CORNERS: OverlayCorner[] = ['top-right', 'top-left', 'bottom-right', 'bottom-left']
const INTERVALS: Config['syncIntervalMinutes'][] = [5, 15, 30, 60]

let cached: Config | null = null

function filePath() {
  return join(app.getPath('userData'), 'config.json')
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n))
}

function sanitize(raw: Partial<Config>): Config {
  const overlayCorner = CORNERS.includes(raw.overlayCorner as OverlayCorner)
    ? (raw.overlayCorner as OverlayCorner)
    : DEFAULT_CONFIG.overlayCorner

  const syncIntervalMinutes = INTERVALS.includes(
    raw.syncIntervalMinutes as Config['syncIntervalMinutes']
  )
    ? (raw.syncIntervalMinutes as Config['syncIntervalMinutes'])
    : DEFAULT_CONFIG.syncIntervalMinutes

  return {
    overlayCorner,
    overlayOpacity: clamp(Number(raw.overlayOpacity) || DEFAULT_CONFIG.overlayOpacity, 0.4, 1),
    overlayWidth: clamp(Math.round(Number(raw.overlayWidth) || DEFAULT_CONFIG.overlayWidth), 280, 560),
    workHoursStart: clamp(Math.round(Number(raw.workHoursStart) ?? DEFAULT_CONFIG.workHoursStart), 0, 23),
    workHoursEnd: clamp(Math.round(Number(raw.workHoursEnd) ?? DEFAULT_CONFIG.workHoursEnd), 1, 24),
    syncIntervalMinutes,
    maxTasksVisible: clamp(Math.round(Number(raw.maxTasksVisible) || DEFAULT_CONFIG.maxTasksVisible), 3, 20),
    ollamaModel: (raw.ollamaModel ?? DEFAULT_CONFIG.ollamaModel).trim() || DEFAULT_CONFIG.ollamaModel,
    embeddingModel:
      (raw.embeddingModel ?? DEFAULT_CONFIG.embeddingModel).trim() || DEFAULT_CONFIG.embeddingModel,
    launchAtLogin: raw.launchAtLogin ?? DEFAULT_CONFIG.launchAtLogin,
    whisperModel:
      (raw.whisperModel ?? DEFAULT_CONFIG.whisperModel).trim() || DEFAULT_CONFIG.whisperModel,
    displayName: (raw.displayName ?? '').trim().slice(0, 80),
    aboutMe: (raw.aboutMe ?? '').trim().slice(0, ABOUT_ME_MAX_CHARS)
  }
}

export function loadConfig(): Config {
  if (cached) return cached
  try {
    const raw = JSON.parse(readFileSync(filePath(), 'utf8')) as Partial<Config>
    cached = sanitize(raw)
  } catch {
    cached = { ...DEFAULT_CONFIG }
  }
  return cached
}

export function saveConfig(patch: Partial<Config>): Config {
  const next = sanitize({ ...loadConfig(), ...patch })
  writeFileSync(filePath(), JSON.stringify(next, null, 2), 'utf8')
  cached = next
  return next
}
