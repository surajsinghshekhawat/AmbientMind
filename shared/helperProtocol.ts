/**
 * The wire format between the app and the Swift helper
 * (native/mac-helper). One JSON object per line, both ways:
 *
 *   app → helper   {"id": 7, "method": "context.focused", "params": {...}}
 *   helper → app   {"id": 7, "ok": true, "result": {...}}
 *                  {"id": 7, "ok": false, "error": {"code": "...", "message": "..."}}
 *                  {"event": "...", "data": {...}}
 *
 * Bump HELPER_PROTOCOL whenever a method changes shape; the helper reports
 * its own in `hello`, and a mismatch keeps the app on its fallbacks.
 */
export const HELPER_PROTOCOL = 1

export type HelperPermissionKind =
  | 'microphone'
  | 'speech'
  | 'accessibility'
  | 'screen'
  | 'calendar'
  | 'reminders'
  | 'contacts'

export type HelperAccess = 'granted' | 'denied' | 'restricted' | 'not-determined'

export interface HelloResult {
  version: string
  protocol: number
  macOS: string
  pid: number
  /** Who macOS attributes the helper's permissions to. */
  responsibleApp: string | null
  responsiblePid: number
  /** The app that started the helper; differs from the above when run from a terminal. */
  parentApp: string | null
  features: string[]
}

export interface FocusedContext {
  app: string | null
  bundleId: string | null
  pid: number
  /** True when the app is on the exclusion list; nothing else is read. */
  excluded: boolean
  axTrusted: boolean
  windowId?: number | null
  bounds?: { x: number; y: number; width: number; height: number } | null
  title?: string | null
  url?: string | null
  selectedText?: string | null
  text?: string
  source?: 'ax' | 'none'
}

export interface OcrResult {
  text: string
  width: number
  height: number
  title?: string | null
  app?: string | null
}

export interface BusyState {
  idleSeconds: number
  /** Something is recording from the default input: usually a call. */
  micInUse: boolean
  fullscreenApp: string | null
}

export interface MeCard {
  name: string
  emails: string[]
  source: 'contacts' | 'account'
}

export interface HelperMethods {
  hello: { params: Record<string, never>; result: HelloResult }
  'perms.status': {
    params: { kinds?: HelperPermissionKind[] }
    result: Partial<Record<HelperPermissionKind, HelperAccess>>
  }
  'perms.request': { params: { kind: HelperPermissionKind }; result: { status: HelperAccess } }
  'context.focused': {
    params: { excludePids?: number[]; excludeBundleIds?: string[]; maxChars?: number }
    result: FocusedContext
  }
  'capture.windowOCR': { params: { windowId: number }; result: OcrResult }
  'capture.displayOCR': { params: { displayId?: number }; result: OcrResult }
  'ocr.image': { params: { png: string }; result: OcrResult }
  'system.busy': { params: Record<string, never>; result: BusyState }
  'contacts.me': { params: Record<string, never>; result: MeCard }
}

export type HelperMethod = keyof HelperMethods

export interface HelperRequest {
  id: number
  method: string
  params: unknown
}

export type HelperMessage =
  | { id: number | null; ok: true; result: unknown }
  | { id: number | null; ok: false; error: { code: string; message: string } }
  | { event: string; data: unknown }

/** Codes the helper sends, plus the client's own for a helper that is not there. */
export type HelperErrorCode =
  | 'bad_request'
  | 'unknown_method'
  | 'permission_denied'
  | 'missing_usage_description'
  | 'not_found'
  | 'no_window'
  | 'capture_failed'
  | 'ocr_failed'
  | 'timeout'
  | 'unavailable'
  | (string & {})

export class HelperError extends Error {
  constructor(
    readonly code: HelperErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'HelperError'
  }
}

export function encodeRequest(request: HelperRequest): string {
  return `${JSON.stringify(request)}\n`
}

/** Anything that is not a well-formed message is dropped rather than trusted. */
export function parseMessage(line: string): HelperMessage | null {
  let value: unknown
  try {
    value = JSON.parse(line)
  } catch {
    return null
  }
  if (!value || typeof value !== 'object') return null
  const message = value as Record<string, unknown>
  if (typeof message.event === 'string') return { event: message.event, data: message.data }
  const id = typeof message.id === 'number' ? message.id : null
  if (message.ok === true) return { id, ok: true, result: message.result }
  if (message.ok === false) {
    const error = (message.error ?? {}) as Record<string, unknown>
    return {
      id,
      ok: false,
      error: {
        code: typeof error.code === 'string' ? error.code : 'unknown',
        message: typeof error.message === 'string' ? error.message : 'The helper reported an error'
      }
    }
  }
  return null
}

/**
 * Splits a byte stream into lines. Chunks arrive cut anywhere, including
 * mid-character, so callers feed it strings from a UTF-8 StringDecoder.
 */
export class LineDecoder {
  private buffer = ''

  constructor(private readonly maxLine = 16 * 1024 * 1024) {}

  push(chunk: string): string[] {
    this.buffer += chunk
    const parts = this.buffer.split('\n')
    this.buffer = parts.pop() ?? ''
    // A line that never ends is a broken helper, not a big answer.
    if (this.buffer.length > this.maxLine) this.buffer = ''
    return parts.map((line) => line.trim()).filter(Boolean)
  }
}

/** Restart delay after the nth consecutive failure: 1s, 2s, 4s … capped at 30s. */
export function restartDelay(failures: number): number {
  return Math.min(30_000, 1000 * 2 ** Math.max(0, failures - 1))
}
