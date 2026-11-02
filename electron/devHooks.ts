import { app } from 'electron'

/**
 * Set at build time (electron.vite.config.ts): true for builds made through
 * ./dev, false for release builds (`npm run dist:release`) and for any build
 * made outside ./dev. Absent when the module runs under the test runners.
 */
declare const __DEV_HOOKS__: boolean | undefined

/**
 * Environment overrides (data folder, helper binary, QA mode, Ollama URL,
 * Google client) and the headless CLI commands. A release build ignores them:
 * anything able to set a launch environment could otherwise point the
 * signed app at its own helper, its own Ollama, or a token-holding command.
 */
export const devHooks: boolean = !app?.isPackaged || (typeof __DEV_HOOKS__ === 'undefined' ? true : __DEV_HOOKS__)

export function devEnv(name: string): string | undefined {
  return devHooks ? process.env[name] : undefined
}

/** The Vite dev server, only ever for an unpackaged run. */
export const rendererDevUrl: string | undefined = app?.isPackaged ? undefined : process.env.ELECTRON_RENDERER_URL
