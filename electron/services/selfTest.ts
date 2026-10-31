import { createRequire } from 'node:module'
import { getTaskStore, listActive, openTaskStore } from './taskStore'

export interface SelfTestResult {
  ok: boolean
  checks: { name: string; ok: boolean; detail: string }[]
}

/**
 * `AmbientMind --selftest`: loads every native and bundled runtime the app
 * depends on and exits. Catches a packaged build that trimmed, failed to
 * sign, or failed to unpack something, without opening a window.
 */
export async function runSelfTest(): Promise<SelfTestResult> {
  const checks: SelfTestResult['checks'] = []
  const check = async (name: string, fn: () => unknown | Promise<unknown>) => {
    try {
      checks.push({ name, ok: true, detail: String((await fn()) ?? 'ok') })
    } catch (err) {
      checks.push({ name, ok: false, detail: (err as Error).message })
    }
  }

  await check('sqlite', () => {
    openTaskStore()
    return `${listActive().length} active tasks`
  })
  await check('sqlite-vec', () => {
    const row = getTaskStore().prepare('select vec_version() as version').get() as { version: string }
    return row.version
  })
  // Importing transformers loads onnxruntime-node and sharp, both native.
  await check('speech runtime', async () => {
    const { env } = await import('@xenova/transformers')
    return `transformers ${env.version}`
  })
  await check('ocr core', () => {
    const require = createRequire(__filename)
    require.resolve('tesseract.js')
    return require.resolve('tesseract.js-core/tesseract-core-simd-lstm.wasm.js')
  })

  return { ok: checks.every((c) => c.ok), checks }
}
