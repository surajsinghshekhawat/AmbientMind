import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { HelperError, type HelperMethod, type HelperMethods } from '@shared/helperProtocol'
import { isMac } from '../platform'
import { HelperClient } from './helperClient'

/**
 * The one helper process for the app's lifetime, Mac only.
 *
 * Packaged, it sits beside the app binary in Contents/MacOS, so it is signed
 * with the app and macOS attributes its permission prompts to AmbientMind.
 * In development it comes from `./dev npm run helper`; AMBIENTMIND_HELPER
 * points elsewhere when set.
 */
let client: HelperClient | null = null

export function helperPath(): string {
  if (process.env.AMBIENTMIND_HELPER) return process.env.AMBIENTMIND_HELPER
  if (app.isPackaged) return join(process.resourcesPath, '..', 'MacOS', 'ambientmind-helper')
  return join(app.getAppPath(), '.local', 'build', 'mac-helper', 'release', 'ambientmind-helper')
}

export function startHelper(): HelperClient | null {
  if (!isMac || client) return client
  const path = helperPath()
  if (!existsSync(path)) {
    console.warn(`[helper] not found at ${path}; using fallbacks (build it with ./dev npm run helper)`)
    return null
  }
  client = new HelperClient({ command: path, log: (message) => console.log(`[helper] ${message}`) })
  client.on('state', (state) => console.log(`[helper] ${state}`))
  client.start()
  return client
}

export async function stopHelper(): Promise<void> {
  const running = client
  client = null
  await running?.stop()
}

export function helperReady(): boolean {
  return client?.state === 'ready'
}

/** Rejects with `unavailable` off the Mac or when the helper is not running. */
export function helperRequest<M extends HelperMethod>(
  method: M,
  params: HelperMethods[M]['params'],
  options: { timeoutMs?: number } = {}
): Promise<HelperMethods[M]['result']> {
  if (!client) return Promise.reject(new HelperError('unavailable', 'No helper on this platform or build'))
  return client.request(method, params, options)
}
