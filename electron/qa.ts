import { appendFileSync, mkdirSync, realpathSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import {
  app,
  BrowserWindow,
  desktopCapturer,
  dialog,
  globalShortcut,
  Notification,
  session,
  shell,
  systemPreferences,
  type MessageBoxOptions
} from 'electron'
import { qaFolderAllowed, qaRequestAllowed, readableBody } from '@shared/qaPolicy'
import { setJson } from './services/secrets'

/**
 * Unattended QA mode (docs/AGENT_QA.md, G2). With AMBIENTMIND_QA=1 and a data
 * folder inside .local/qa/runs/, every call that reaches outside the app is
 * replaced by a recorder that appends the attempt to attempts-app.jsonl and
 * returns a scripted answer. Without both, this module does nothing.
 */

export interface QaAttempt {
  at: string
  kind: string
  blocked: boolean
  detail: Record<string, unknown>
}

interface QaControl {
  logPath: string
  /** How the next confirmation dialogs are answered. */
  dialogAnswer: 'confirm' | 'cancel'
  /** Returned by the next open dialog; null cancels it. */
  openPath: string | null
  notifications: Notification[]
  attempts: QaAttempt[]
  /** Presses a notification's button, as if the user had. */
  press: (index: number, actionIndex: number) => boolean
  click: (index: number) => boolean
  /** Filled in by main.ts once the windows exist. */
  actions: Record<string, (...args: any[]) => unknown>
}

declare global {
  var __qa: QaControl | undefined
}

export const qaEnabled = process.env.AMBIENTMIND_QA === '1'

const GOOGLE_HOSTS = new Set(['oauth2.googleapis.com', 'gmail.googleapis.com', 'www.googleapis.com'])

/** AMBIENTMIND_QA_GOOGLE, if it names a server on this machine. */
function fakeGoogleBase(): string | null {
  const raw = process.env.AMBIENTMIND_QA_GOOGLE
  if (!raw) return null
  try {
    const url = new URL(raw)
    if (url.protocol === 'http:' && (url.hostname === '127.0.0.1' || url.hostname === 'localhost')) return url.origin
  } catch {
    // Falls through to the refusal below.
  }
  console.error(`[qa] ignoring AMBIENTMIND_QA_GOOGLE=${raw}: only http://127.0.0.1 is allowed`)
  return null
}

export function installQaMode(): QaControl | null {
  if (!qaEnabled) return null
  const dataDir = process.env.AMBIENTMIND_DATA_DIR
  let real: string | undefined
  try {
    real = dataDir ? realpathSync(dataDir) : undefined
  } catch {
    real = dataDir
  }
  if (!qaFolderAllowed(dataDir) || !qaFolderAllowed(real)) {
    console.error(`[qa] refusing to start: ${dataDir ?? '(no data folder)'} is not inside .local/qa/runs/`)
    app.exit(2)
    return null
  }

  const runDir = dirname(dataDir!)
  const control: QaControl = {
    logPath: process.env.AMBIENTMIND_QA_LOG ?? join(runDir, 'attempts-app.jsonl'),
    dialogAnswer: 'confirm',
    openPath: null,
    notifications: [],
    attempts: [],
    press: (index, actionIndex) => {
      const notice = control.notifications[index]
      if (!notice) return false
      notice.emit('action', { actionIndex }, actionIndex)
      return true
    },
    click: (index) => {
      const notice = control.notifications[index]
      if (!notice) return false
      notice.emit('click', {})
      return true
    },
    actions: {}
  }
  globalThis.__qa = control
  mkdirSync(dirname(control.logPath), { recursive: true })

  const record = (kind: string, detail: Record<string, unknown>, blocked = true) => {
    const attempt: QaAttempt = { at: new Date().toISOString(), kind, blocked, detail }
    control.attempts.push(attempt)
    try {
      appendFileSync(control.logPath, `${JSON.stringify(attempt)}\n`)
    } catch (err) {
      console.error('[qa] could not record an attempt:', (err as Error).message)
    }
  }
  record('qa.start', { dataDir, pid: process.pid }, false)

  shell.openExternal = async (url) => record('shell.openExternal', { url })
  shell.openPath = async (path) => {
    record('shell.openPath', { path })
    return ''
  }
  shell.showItemInFolder = (path) => record('shell.showItemInFolder', { path })
  shell.trashItem = async (path) => record('shell.trashItem', { path })

  const answer = (options: MessageBoxOptions) => {
    const buttons = options.buttons ?? ['OK']
    const cancel = options.cancelId ?? Math.max(0, buttons.findIndex((b) => /cancel|keep|not now/i.test(b)))
    const confirm = buttons.findIndex((_, i) => i !== cancel)
    return control.dialogAnswer === 'cancel' ? cancel : Math.max(0, confirm)
  }
  const messageOptions = (a: unknown, b: unknown) => ((b ?? a) as MessageBoxOptions)
  dialog.showMessageBox = (async (a: unknown, b?: unknown) => {
    const options = messageOptions(a, b)
    const response = answer(options)
    record('dialog.showMessageBox', { message: options.message, buttons: options.buttons, response }, false)
    return { response, checkboxChecked: false }
  }) as typeof dialog.showMessageBox
  dialog.showMessageBoxSync = ((a: unknown, b?: unknown) => {
    const options = messageOptions(a, b)
    const response = answer(options)
    record('dialog.showMessageBoxSync', { message: options.message, buttons: options.buttons, response }, false)
    return response
  }) as typeof dialog.showMessageBoxSync
  dialog.showErrorBox = (title, content) => record('dialog.showErrorBox', { title, content }, false)
  dialog.showSaveDialog = (async (a: unknown, b?: unknown) => {
    const options = (b ?? a) as { defaultPath?: string }
    const filePath = join(runDir, 'saved', basename(options.defaultPath ?? 'saved-file'))
    mkdirSync(dirname(filePath), { recursive: true })
    record('dialog.showSaveDialog', { defaultPath: options.defaultPath, filePath }, false)
    return { canceled: false, filePath }
  }) as typeof dialog.showSaveDialog
  dialog.showOpenDialog = (async () => {
    const filePaths = control.openPath ? [control.openPath] : []
    record('dialog.showOpenDialog', { filePaths }, false)
    return { canceled: filePaths.length === 0, filePaths }
  }) as typeof dialog.showOpenDialog

  Notification.prototype.show = function show(this: Notification) {
    control.notifications.push(this)
    record('notification', { index: control.notifications.length - 1, title: this.title, body: this.body, actions: this.actions })
  }

  globalShortcut.register = ((accelerator: string) => {
    record('globalShortcut.register', { accelerator })
    return true
  }) as typeof globalShortcut.register
  globalShortcut.registerAll = ((accelerators: string[]) => {
    record('globalShortcut.registerAll', { accelerators })
  }) as typeof globalShortcut.registerAll

  app.setLoginItemSettings = (settings) => record('app.setLoginItemSettings', { ...settings })
  // A relaunched app would run outside the harness that drives this one.
  app.relaunch = (options) => record('app.relaunch', { ...options }, false)
  app.focus = () => {}
  if (app.dock) app.dock.show = async () => {}

  systemPreferences.askForMediaAccess = async (mediaType) => {
    record('systemPreferences.askForMediaAccess', { mediaType })
    return false
  }
  const trusted = systemPreferences.isTrustedAccessibilityClient.bind(systemPreferences)
  systemPreferences.isTrustedAccessibilityClient = (prompt: boolean) => {
    if (prompt) record('systemPreferences.isTrustedAccessibilityClient', { prompt })
    return prompt ? false : trusted(false)
  }
  desktopCapturer.getSources = async (options) => {
    record('desktopCapturer.getSources', { types: options.types })
    return []
  }

  // Pages ask Chromium for the microphone directly (Quick Capture's Whisper
  // fallback, the onboarding mic test). Fake devices mean no real one opens
  // even if a grant slipped through; the handlers below refuse it anyway.
  app.commandLine.appendSwitch('use-fake-device-for-media-stream')
  const DENIED_PERMISSIONS = new Set(['media', 'display-capture'])
  void app.whenReady().then(() => {
    const ses = session.defaultSession
    const setRequest = ses.setPermissionRequestHandler.bind(ses)
    const setCheck = ses.setPermissionCheckHandler.bind(ses)
    ses.setPermissionRequestHandler = (handler) =>
      setRequest((wc, permission, callback, details) => {
        if (DENIED_PERMISSIONS.has(permission)) {
          const mediaTypes = 'mediaTypes' in details ? details.mediaTypes : undefined
          record(`permission.${permission}`, { mediaTypes, url: details.requestingUrl ?? wc.getURL() })
          callback(false)
        } else if (handler) handler(wc, permission, callback, details)
        else callback(true)
      })
    ses.setPermissionCheckHandler = (handler) =>
      setCheck((wc, permission, origin, details) =>
        DENIED_PERMISSIONS.has(permission) ? false : handler ? handler(wc, permission, origin, details) : true
      )
    ses.setPermissionRequestHandler(null)
    ses.setPermissionCheckHandler(null)
  })

  // Windows exist and render (Playwright drives them, capturePage reads
  // them) but are never seen, clicked or focused on the user's screen.
  const proto = BrowserWindow.prototype
  const showInactive = proto.showInactive
  proto.show = function show(this: BrowserWindow) {
    showInactive.call(this)
  }
  proto.focus = () => {}
  proto.moveTop = () => {}
  const setOpacity = proto.setOpacity
  const setIgnoreMouseEvents = proto.setIgnoreMouseEvents
  app.on('browser-window-created', (_event, win) => {
    setOpacity.call(win, 0)
    setIgnoreMouseEvents.call(win, true)
  })
  proto.setOpacity = () => {}
  proto.setIgnoreMouseEvents = () => {}

  // With a fake Google running (scripts/fake-google.cjs), Google's hosts are
  // answered by it, and this instance is signed in with a throwaway token.
  const fakeGoogle = fakeGoogleBase()
  if (fakeGoogle) {
    void app.whenReady().then(() => {
      setJson('google.tokens', {
        accessToken: 'qa-fake',
        refreshToken: 'qa-fake',
        expiresAt: Date.now() + 3_600_000,
        scope: 'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/calendar.readonly',
        email: 'sally.beck@enron.com'
      })
      record('qa.fakeGoogle', { base: fakeGoogle }, false)
    })
  }

  // Innermost fetch wrapper: installed before the network log wraps fetch,
  // so nothing in the main process can go around it.
  const original = globalThis.fetch
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    let url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (fakeGoogle) {
      const parsed = new URL(url)
      if (GOOGLE_HOSTS.has(parsed.hostname)) {
        url = `${fakeGoogle}${parsed.pathname}${parsed.search}`
        input = url
      }
    }
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET')
    const verdict = qaRequestAllowed({ url, method, body: readableBody(init?.body) })
    if (!verdict.allowed) {
      record('network', { url: url.split('?')[0], method, reason: verdict.reason })
      throw new TypeError(`QA mode blocked ${method} ${url.split('?')[0]}: ${verdict.reason}`)
    }
    return original(input, init)
  }) as typeof fetch

  void app.whenReady().then(() => {
    session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
      const verdict = qaRequestAllowed({ url: details.url, method: details.method })
      if (!verdict.allowed) record('network.window', { url: details.url.split('?')[0], method: details.method, reason: verdict.reason })
      callback({ cancel: !verdict.allowed })
    })
  })

  console.log(`[qa] QA mode on; attempts go to ${control.logPath}`)
  return control
}

// Like isolation.ts, applied on import: main.ts imports this second, before
// any module that could reach outside the app.
export const qaControl = installQaMode()
