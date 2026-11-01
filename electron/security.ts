/**
 * Security decisions for the renderers, kept free of Electron so they can be
 * tested. main.ts wires them into the session and every webContents.
 */

import { isAbsolute, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Our pages: the bundled files, or the Vite dev server while developing. With
 * `rendererDir`, a file has to be inside it; any other file on disk is not ours.
 */
export function isAppUrl(url: string, devServerUrl?: string, rendererDir?: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (parsed.protocol === 'file:') {
    if (!rendererDir) return true
    let file: string
    try {
      file = fileURLToPath(parsed)
    } catch {
      return false
    }
    const inside = relative(resolve(rendererDir), resolve(file))
    return inside !== '' && !inside.startsWith('..') && !isAbsolute(inside)
  }
  if (!devServerUrl) return false
  return parsed.origin === new URL(devServerUrl).origin
}

/**
 * Quick Add's voice input is the only thing that needs a permission. Video,
 * DRM (`mediaKeySystem`), notifications and the rest stay denied, as does
 * anything asked for by a page that is not ours.
 */
export function allowPermission(
  permission: string,
  details: { mediaTypes?: string[]; url: string; devServerUrl?: string; rendererDir?: string }
): boolean {
  if (permission !== 'media') return false
  if (!isAppUrl(details.url, details.devServerUrl, details.rendererDir)) return false
  const types = details.mediaTypes ?? []
  return types.length > 0 && types.every((type) => type === 'audio')
}

/**
 * Builds deliver it as a <meta> tag, which ignores frame-ancestors, so the
 * policy leaves it out rather than log a warning on every window.
 *
 * Applied in development too, so a page that only works without it fails
 * here first. Dev adds what Vite needs: React Refresh's inline preamble and
 * the HMR websocket on the dev server's own origin.
 */
export function contentSecurityPolicy(devServerUrl?: string): string {
  const dev = devServerUrl ? new URL(devServerUrl) : null
  const directives = [
    "default-src 'self'",
    dev ? "script-src 'self' 'unsafe-inline'" : "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    dev ? `connect-src 'self' ws://${dev.host}` : "connect-src 'self'",
    "media-src 'self' mediastream:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'"
  ]
  return directives.join('; ')
}
