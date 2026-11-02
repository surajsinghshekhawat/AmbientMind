import { copyFileSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { sanitizeConfig as sanitize } from '@shared/config'
import { normalizePauseAiUntil } from '@shared/pauseAi'
import { DEFAULT_CONFIG, type Config } from '@shared/types'

let cached: Config | null = null

function filePath() {
  return join(app.getPath('userData'), 'config.json')
}

export function loadConfig(): Config {
  if (!cached) {
    try {
      const raw = JSON.parse(readFileSync(filePath(), 'utf8')) as Partial<Config>
      cached = sanitize(raw)
    } catch (err) {
      const missing = (err as NodeJS.ErrnoException).code === 'ENOENT'
      console.warn('[config] using defaults:', (err as Error).message)
      if (missing) {
        cached = { ...DEFAULT_CONFIG }
      } else {
        // Only someone already set up has a config to break: keep the broken
        // file for inspection and don't send them back through onboarding.
        copyFileSync(filePath(), `${filePath()}.corrupt`)
        cached = { ...DEFAULT_CONFIG, onboarded: true }
      }
    }
  }
  // Expiry is wall-clock, so a cached future timestamp must drop once it elapses.
  const pauseAiUntil = normalizePauseAiUntil(cached.pauseAiUntil)
  if (pauseAiUntil !== cached.pauseAiUntil) {
    cached = { ...cached, pauseAiUntil }
  }
  return cached
}

export function saveConfig(patch: Partial<Config>): Config {
  const next = sanitize({ ...loadConfig(), ...patch })
  writeFileSync(filePath(), JSON.stringify(next, null, 2), 'utf8')
  cached = next
  return next
}
