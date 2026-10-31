import type { SpeechStatus } from '@shared/helperProtocol'
import { IPC } from '@shared/ipc'
import type { SpeechEngineInfo } from '@shared/types'
import { helperReady, helperRequest, onHelperEvent, onHelperState } from '../native/helper'
import { isMac } from '../platform'
import { getQuickAddWindow } from '../quickAdd'
import { listActive } from './taskStore'
import { warmSpeechModel } from './speech'

/**
 * Picks the voice engine and runs Apple's.
 *
 * On a Mac with the helper and the system speech model, SpeechAnalyzer
 * streams words while you talk and finishes within a moment of stopping.
 * Everywhere else, and until that model is downloaded, Whisper transcribes
 * the recording afterwards, as before.
 */

let status: SpeechStatus | null = null
let installing: number | null = null

export function speechEngine(): SpeechEngineInfo {
  if (!isMac) return { engine: 'whisper', apple: null, installing: null }
  return {
    engine: helperReady() && status?.available && status.installed ? 'apple' : 'whisper',
    apple: status,
    installing
  }
}

async function refresh(): Promise<void> {
  try {
    status = await helperRequest('speech.status', {}, { timeoutMs: 10_000 })
  } catch {
    status = null
  }
}

/** Live words and the input level go to whoever is listening: Quick Capture. */
function forward(channel: string, payload: unknown) {
  const win = getQuickAddWindow()
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
}

/**
 * Starts tracking the helper. Whisper is only loaded when it will be used:
 * at 150 MB-plus it is not worth holding when Apple's model is there.
 */
export function initLiveSpeech(): void {
  if (!isMac) {
    void warmSpeechModel().catch((err) => console.warn('[speech] warm failed:', err))
    return
  }
  onHelperEvent('speech.partial', (data) => forward(IPC.SpeechPartial, data))
  onHelperEvent('speech.level', (data) => forward(IPC.SpeechLevel, data.rms))
  onHelperEvent('speech.error', (data) => console.warn('[speech] apple:', data.message))
  onHelperEvent('speech.install', (data) => (installing = data.fraction))
  let warmed = false
  const decide = async () => {
    await refresh()
    if (speechEngine().engine === 'whisper' && !warmed) {
      warmed = true
      void warmSpeechModel().catch((err) => console.warn('[speech] warm failed:', err))
    }
  }
  onHelperState((state) => {
    if (state === 'ready') void decide()
  })
  // No helper at all (not built, or it never comes up): Whisper it is.
  setTimeout(() => {
    if (!helperReady()) void decide()
  }, 8000)
}

/** Names and recent task words, so "Priya" is not heard as "pre-ah". */
function hints(userName: string): string[] {
  const words = new Set<string>()
  if (userName) words.add(userName)
  for (const task of listActive().slice(0, 60)) {
    for (const person of task.people) words.add(person)
    if (task.title.length <= 60) words.add(task.title)
  }
  return [...words].slice(0, 100)
}

export async function startLiveSpeech(userName: string): Promise<void> {
  await helperRequest('speech.start', { hints: hints(userName) }, { timeoutMs: 15_000 })
}

export async function stopLiveSpeech(): Promise<string> {
  const { text } = await helperRequest('speech.stop', {}, { timeoutMs: 15_000 })
  return text
}

export function cancelLiveSpeech(): void {
  void helperRequest('speech.cancel', {}).catch(() => {})
}

/** Fetches the system speech model. Only ever started by the user. */
export async function installAppleSpeech(): Promise<SpeechEngineInfo> {
  installing = 0
  try {
    status = await helperRequest('speech.install', {}, { timeoutMs: 30 * 60_000 })
  } finally {
    installing = null
  }
  return speechEngine()
}
