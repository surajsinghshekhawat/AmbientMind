import { randomBytes } from 'node:crypto'
import { appendFileSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
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
import { QA_LIVE_TITLE, qaFolderAllowed, qaRequestAllowed, readableBody, type QaLiveGoogle } from '@shared/qaPolicy'
import { devEnv } from './devHooks'
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

export const qaEnabled = devEnv('AMBIENTMIND_QA') === '1'
/** Real helper, real Reminders and Calendar, Google writes to QA_LIVE_TITLE only. */
export const qaLive = qaEnabled && process.env.AMBIENTMIND_QA_LIVE === '1'
const liveCalendars = new Set<string>()
const liveGoogle: QaLiveGoogle | undefined = qaLive ? { calendars: liveCalendars } : undefined

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
  // AMBIENTMIND_QA_FAKE_MIC=1 lets audio through to the fake device (a test
  // tone) so the voice path can be driven; AMBIENTMIND_QA_FAKE_MIC_FILE, a WAV
  // in the run folder, plays speech through it instead.
  app.commandLine.appendSwitch('use-fake-device-for-media-stream')
  const fakeMic = process.env.AMBIENTMIND_QA_FAKE_MIC === '1'
  const micFile = process.env.AMBIENTMIND_QA_FAKE_MIC_FILE
  if (fakeMic && micFile) {
    if (qaFolderAllowed(dirname(micFile))) {
      app.commandLine.appendSwitch('use-file-for-fake-audio-capture', `${micFile}%noloop`)
      // The sandboxed audio service can't open the file; in-process it can.
      app.commandLine.appendSwitch('disable-features', 'AudioServiceOutOfProcess')
    } else console.error(`[qa] ignoring AMBIENTMIND_QA_FAKE_MIC_FILE=${micFile}: not inside a run folder`)
  }
  const DENIED_PERMISSIONS = new Set(['media', 'display-capture'])
  const audioOnly = (types: readonly string[] | undefined) => !!types?.length && types.every((t) => t === 'audio')
  void app.whenReady().then(() => {
    const ses = session.defaultSession
    const setRequest = ses.setPermissionRequestHandler.bind(ses)
    const setCheck = ses.setPermissionCheckHandler.bind(ses)
    ses.setPermissionRequestHandler = (handler) =>
      setRequest((wc, permission, callback, details) => {
        const mediaTypes = 'mediaTypes' in details ? details.mediaTypes : undefined
        if (permission === 'media' && fakeMic && audioOnly(mediaTypes)) {
          record('permission.media', { mediaTypes, url: details.requestingUrl ?? wc.getURL(), fake: true }, false)
          callback(true)
        } else if (DENIED_PERMISSIONS.has(permission)) {
          record(`permission.${permission}`, { mediaTypes, url: details.requestingUrl ?? wc.getURL() })
          callback(false)
        } else if (handler) handler(wc, permission, callback, details)
        else callback(true)
      })
    ses.setPermissionCheckHandler = (handler) =>
      setCheck((wc, permission, origin, details) => {
        const mediaType = 'mediaType' in details ? details.mediaType : undefined
        if (permission === 'media' && fakeMic && (mediaType === 'audio' || mediaType === undefined)) return true
        if (DENIED_PERMISSIONS.has(permission)) return false
        return handler ? handler(wc, permission, origin, details) : true
      })
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
    const verdict = qaRequestAllowed({ url, method, body: readableBody(init?.body) }, liveGoogle)
    if (!verdict.allowed) {
      record('network', { url: url.split('?')[0], method, reason: verdict.reason })
      throw new TypeError(`QA mode blocked ${method} ${url.split('?')[0]}: ${verdict.reason}`)
    }
    const response = await original(input, init)
    if (liveGoogle && response.ok) learnQaCalendars(url, method, response.clone())
    return response
  }) as typeof fetch

  // The QA calendar's id is only known once Google has listed or created it.
  function learnQaCalendars(url: string, method: string, response: Response) {
    const path = new URL(url).pathname
    const listing = method === 'GET' && path === '/calendar/v3/users/me/calendarList'
    const creating = method === 'POST' && path === '/calendar/v3/calendars'
    if (!listing && !creating) return
    void response
      .json()
      .then((data: { id?: string; summary?: string; items?: { id: string; summary?: string }[] }) => {
        for (const entry of creating ? [data] : (data.items ?? [])) {
          if (entry.id && entry.summary === QA_LIVE_TITLE && !liveCalendars.has(entry.id)) {
            liveCalendars.add(entry.id)
            record('qa.liveCalendar', { id: entry.id }, false)
          }
        }
      })
      .catch(() => {})
  }

  if (process.env.AMBIENTMIND_QA_CONTROL) startControl(process.env.AMBIENTMIND_QA_CONTROL, control, record)

  void app.whenReady().then(() => {
    session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
      const verdict = qaRequestAllowed({ url: details.url, method: details.method }, liveGoogle)
      if (!verdict.allowed) record('network.window', { url: details.url.split('?')[0], method: details.method, reason: verdict.reason })
      callback({ cancel: !verdict.allowed })
    })
  })

  console.log(`[qa] QA mode on${qaLive ? ' (live)' : ''}; attempts go to ${control.logPath}`)
  return control
}

/**
 * For a run opened through LaunchServices, which Playwright can't launch: a
 * loopback endpoint that runs the registered QA actions, nothing else. Its
 * port and a one-time token go to `file`, inside the run folder.
 */
function startControl(file: string, control: QaControl, record: (kind: string, detail: Record<string, unknown>, blocked?: boolean) => void) {
  if (!qaFolderAllowed(dirname(file))) {
    console.error(`[qa] no control endpoint: ${file} is not inside a run folder`)
    return
  }
  const token = randomBytes(24).toString('hex')
  const server = createServer((req, res) => {
    const reply = (status: number, body: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(body))
    }
    if (req.method !== 'POST' || req.url !== '/action' || req.headers.authorization !== `Bearer ${token}`) return reply(403, { error: 'no' })
    let body = ''
    req.on('data', (chunk: Buffer) => (body += chunk.toString()))
    req.on('end', () => {
      void (async () => {
        try {
          const { name, args = [] } = JSON.parse(body) as { name: string; args?: unknown[] }
          if (name === 'attempts') return reply(200, { result: control.attempts })
          const fn = control.actions[name]
          if (!fn) return reply(404, { error: `QA action ${name} is not registered` })
          const result = await fn(...args)
          const plain = result !== null && typeof result === 'object' && result.constructor !== Object && !Array.isArray(result) ? null : (result ?? null)
          reply(200, { result: plain })
        } catch (err) {
          reply(500, { error: (err as Error).message })
        }
      })()
    })
  })
  server.listen(0, '127.0.0.1', () => {
    const { port } = server.address() as AddressInfo
    writeFileSync(file, JSON.stringify({ port, token, pid: process.pid }), { mode: 0o600 })
    record('qa.control', { port }, false)
  })
  app.on('will-quit', () => server.close())
}

// Like isolation.ts, applied on import: main.ts imports this second, before
// any module that could reach outside the app.
export const qaControl = installQaMode()
