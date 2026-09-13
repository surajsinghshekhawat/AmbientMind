import { join } from 'node:path'
import { app } from 'electron'

/**
 * Local speech-to-text via Transformers.js.
 *
 * Chosen over a whisper.cpp native addon on purpose: native addons have to be
 * rebuilt for Electron's Node ABI, and this machine already struggled with
 * better-sqlite3. Transformers.js downloads an ONNX model once and runs
 * entirely in-process with no compile step. The tradeoff is a cold start of a
 * few seconds the first time the mic is used in a session.
 *
 * The model is a setting rather than a constant. tiny.en is fast and visibly
 * weak on accented English; base.en costs roughly twice the load and is the
 * better default on a machine that is not doing anything else while you talk.
 * All of these run on CPU, so the choice trades latency against accuracy, not
 * VRAM against the 3B model.
 *
 * Audio must already be mono float32 PCM at 16 kHz — the renderer resamples
 * before sending, so this module never touches the microphone.
 */

import { DEFAULT_CONFIG } from '@shared/types'

type Transcriber = (
  audio: Float32Array,
  options?: { sampling_rate?: number; return_timestamps?: boolean }
) => Promise<{ text: string }>

let transcriber: Transcriber | null = null
let loading: Promise<Transcriber> | null = null
let activeModel: string = DEFAULT_CONFIG.whisperModel

async function getTranscriber(): Promise<Transcriber> {
  if (transcriber) return transcriber
  if (loading) return loading

  const model = activeModel
  loading = (async () => {
    // Dynamic import keeps the heavy ONNX runtime out of the main startup path.
    const { env, pipeline } = await import('@xenova/transformers')
    env.cacheDir = join(app.getPath('userData'), 'whisper')
    env.allowLocalModels = false

    console.log(`[speech] loading ${model}…`)
    const started = Date.now()
    const pipe = (await pipeline(
      'automatic-speech-recognition',
      model
    )) as unknown as Transcriber
    console.log(`[speech] ready in ${Date.now() - started}ms`)
    transcriber = pipe
    return pipe
  })()

  try {
    return await loading
  } finally {
    loading = null
  }
}

/**
 * Switching models drops the cached pipeline so the next transcription loads
 * the new one. The first download can be a few hundred megabytes, so the warm
 * is fired immediately rather than left to surprise the user mid-sentence.
 */
export function setSpeechModel(model: string): void {
  if (model === activeModel) return
  activeModel = model
  transcriber = null
  loading = null
  void warmSpeechModel().catch((err) => console.warn('[speech] warm failed:', err))
}

export async function warmSpeechModel(): Promise<void> {
  await getTranscriber()
}

/**
 * Transcribes mono float32 PCM sampled at 16 kHz. Empty or near-silent
 * buffers return an empty string rather than hallucinated filler.
 */
export async function transcribePcm(samples: Float32Array): Promise<string> {
  if (samples.length < 1600) return '' // < 100ms at 16 kHz: nothing useful

  // Rough energy gate so a silent hold does not invent "Thank you." etc.
  let energy = 0
  const step = Math.max(1, Math.floor(samples.length / 2000))
  for (let i = 0; i < samples.length; i += step) energy += Math.abs(samples[i]!)
  if (energy / (samples.length / step) < 0.004) return ''

  const pipe = await getTranscriber()
  const result = await pipe(samples, { sampling_rate: 16_000 })
  return (result.text ?? '').trim()
}

export function disposeSpeech() {
  transcriber = null
  loading = null
}
