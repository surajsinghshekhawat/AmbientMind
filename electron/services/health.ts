import type { HealthReport, ModelHealth } from '@shared/types'
import { describePause, isAiPaused } from '@shared/pauseAi'
import { describeAppleReason } from '@shared/aiStatus'
import { syncProblem } from '@shared/syncProblem'
import type { AiEnginePreference } from '@shared/types'
import { aiPreference, appleModelStatus, chooseEngine } from './ai'
import { OLLAMA_URL, listModels } from './ollama'
import { GOOGLE_SCOPES_MESSAGE, hasCalendarWriteScope, hasReadScopes, isGoogleConnected, loadCredentials } from './googleAuth'

/**
 * Ollama reports tags as `name:tag`, and an untagged pull lands as `:latest`.
 * A config value of `qwen2.5:3b` must match `qwen2.5:3b`, and `nomic-embed-text`
 * must match `nomic-embed-text:latest`.
 */
function hasModel(installed: string[], wanted: string): boolean {
  const want = wanted.includes(':') ? wanted : `${wanted}:latest`
  return installed.some((name) => {
    const full = name.includes(':') ? name : `${name}:latest`
    return full === want
  })
}

export interface HealthInput {
  ollamaModel: string
  embeddingModel: string
  /** Checked only when the user has asked for calendar write-back. */
  calendarWriteBack?: boolean
  pauseAiUntil?: string | null
  aiEngine?: AiEnginePreference
  /** What the last pass of any source failed on, if it did. */
  lastSyncError?: string | null
}

/**
 * Answers "why is my list empty?" without making the user read a terminal.
 * Never throws: a broken check must still render as a diagnosis.
 */
export async function checkHealth(config: HealthInput): Promise<HealthReport> {
  const wanted: { name: string; role: ModelHealth['role'] }[] = [
    { name: config.ollamaModel, role: 'extraction' },
    { name: config.embeddingModel, role: 'embedding' }
  ]

  let installed: string[] = []
  let running = false
  try {
    installed = await listModels()
    running = true
  } catch {
    running = false
  }

  const models: ModelHealth[] = wanted.map(({ name, role }) => ({
    name,
    role,
    // Unknowable while the server is down; do not accuse the user of a missing
    // pull when the real problem is that Ollama is not started.
    present: running ? hasModel(installed, name) : false
  }))

  const googleConnected = isGoogleConnected()
  const credentialsConfigured = loadCredentials() !== null

  const problems: string[] = []
  if (isAiPaused(config.pauseAiUntil) && config.pauseAiUntil) {
    problems.push(describePause(config.pauseAiUntil))
  }
  const preference = config.aiEngine ?? aiPreference()
  const apple = await appleModelStatus(true)
  const engine = await chooseEngine()
  if (!engine) {
    problems.push(
      preference === 'apple'
        ? describeAppleReason(apple?.reason)
        : preference === 'ollama'
          ? `Ollama is not reachable at ${OLLAMA_URL}. Start it, then re-check.`
          : 'No AI model is available: turn on Apple Intelligence, or start Ollama.'
    )
  }
  // With Apple answering, Ollama only holds the memory of past mail, which is
  // optional; its task model doesn't matter at all.
  if (running) {
    for (const model of models) {
      if (model.present || (engine === 'apple' && model.role === 'extraction')) continue
      problems.push(`Model "${model.name}" is not pulled. Run: ./dev ollama pull ${model.name}`)
    }
  } else if (engine === 'ollama') {
    problems.push(`Ollama is not reachable at ${OLLAMA_URL}. Start it, then re-check.`)
  }
  if (!credentialsConfigured) {
    problems.push('No Google OAuth client. See docs/google-setup.md.')
  } else if (!googleConnected) {
    problems.push('Google is not connected, so mail and calendar cannot fill the list.')
  } else if (!hasReadScopes()) {
    problems.push(GOOGLE_SCOPES_MESSAGE)
  } else if (config.calendarWriteBack && !hasCalendarWriteScope()) {
    // Write-back shipped after the first release, so an older grant simply
    // does not carry the permission. Silence here would look like the feature
    // was broken rather than un-granted.
    problems.push(
      'Reconnect Google to finish enabling calendar write-back — your existing sign-in predates it.'
    )
  }
  const lastSync = syncProblem(config.lastSyncError)
  if (lastSync) problems.push(lastSync)

  return {
    checkedAt: new Date().toISOString(),
    ollama: { running, url: OLLAMA_URL },
    models,
    ai: { preference, engine, apple: apple ? { available: apple.available, reason: apple.reason } : null },
    google: { connected: googleConnected, credentialsConfigured },
    problems,
    // Extraction can run without Google; Google cannot produce tasks without a
    // model. Both are required for the product to do what it promises.
    ok: problems.length === 0
  }
}
