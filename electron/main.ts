import { userInfo } from 'node:os'
import { app, globalShortcut, ipcMain, Notification, session, shell } from 'electron'
import { CAPTURE_SCREEN_SHORTCUT, IPC, QUICK_ADD_SHORTCUT, SETTINGS_SHORTCUT } from '@shared/ipc'

// Windows 11 otherwise paints a gray DWM plate around transparent overlays.
app.commandLine.appendSwitch('enable-transparent-visuals')
app.commandLine.appendSwitch('disable-features', 'EnableTransparentHwndEnlargement')
import {
  applyOverlayConfig,
  createOverlayWindow,
  getOverlayWindow,
  setMouseCapture,
  setOverlayExpanded
} from './overlay'
import {
  createQuickAddWindow,
  hideQuickAdd,
  setQuickAddRecording,
  toggleQuickAdd
} from './quickAdd'
import { showSettingsWindow } from './settings'
import { createTray } from './tray'
import {
  addTask,
  archiveStaleCompleted,
  closeTaskStore,
  deleteTask,
  getTaskStore,
  listActive,
  openTaskStore,
  setStatus,
  updateTask
} from './services/taskStore'
import { enrichTask } from './services/ollama'
import {
  connectGoogle,
  connectedGoogleAccount,
  disconnectGoogle,
  isGoogleConnected,
  loadCredentials
} from './services/googleAuth'
import { runSync, startScheduler, stopScheduler, type SyncReport } from './services/sync'
import { disposeScreenContext, screenToTask } from './services/screenContext'
import { disposeSpeech, transcribePcm, warmSpeechModel } from './services/speech'
import { loadConfig, saveConfig } from './services/config'
import { exampleCount } from './services/vectorStore'
import { isScreenCaptureIntent } from '@shared/voiceIntent'
import type { Config } from '@shared/types'
import { seedIfEmpty } from './seedTasks'

const ARCHIVE_SWEEP_MS = 15 * 60_000

let trayHandle: { refresh: () => void } | null = null

function broadcastTasks() {
  getOverlayWindow()?.webContents.send(IPC.TasksChanged, listActive())
}

function syncOptions(config: Config = loadConfig(), extra: { force?: boolean } = {}) {
  const email = connectedGoogleAccount()
  return {
    model: config.ollamaModel,
    embeddingModel: config.embeddingModel,
    userName: currentUserName(),
    ...(email ? { userEmail: email } : {}),
    ...extra
  }
}

function applyLiveConfig(config: Config, previous?: Config) {
  applyOverlayConfig(config)
  getOverlayWindow()?.webContents.send(IPC.ConfigChanged, config)
  if (
    !previous ||
    previous.syncIntervalMinutes !== config.syncIntervalMinutes ||
    previous.ollamaModel !== config.ollamaModel ||
    previous.embeddingModel !== config.embeddingModel
  ) {
    startScheduler(config.syncIntervalMinutes, syncOptions(config))
  }
}

function registerIpc() {
  ipcMain.on(IPC.SetMouseCapture, (_event, capture: boolean) => setMouseCapture(capture))

  ipcMain.handle(IPC.SetOverlayExpanded, (_event, expanded: boolean) => {
    setOverlayExpanded(expanded)
  })
  // Older preload used send() instead of invoke(); keep both so a stale
  // renderer can still collapse/expand.
  ipcMain.on(IPC.SetOverlayExpanded, (_event, expanded: boolean) => {
    setOverlayExpanded(expanded)
  })

  ipcMain.handle(IPC.GetTasks, () => listActive())

  ipcMain.handle(IPC.AddTask, (_event, title: string) => {
    addTask({ title, source: 'manual' })
    broadcastTasks()
    return listActive()
  })

  ipcMain.handle(IPC.CompleteTask, (_event, id: string) => {
    setStatus(id, 'done')
    broadcastTasks()
    return listActive()
  })

  ipcMain.handle(IPC.DeleteTask, (_event, id: string) => {
    deleteTask(id)
    broadcastTasks()
    return listActive()
  })

  ipcMain.on(IPC.QuickAddSubmit, (_event, title: string) => {
    const trimmed = title.trim()
    hideQuickAdd()
    setQuickAddRecording(false)
    if (!trimmed) return

    // Voice (and typed) "add what's on my screen" routes into the same
    // capture pipeline as Ctrl+Shift+S, with the utterance as instruction.
    if (isScreenCaptureIntent(trimmed)) {
      void captureScreenAsTask(trimmed)
      return
    }

    // Insert immediately so the overlay never waits on the model, then upgrade
    // the row in place once enrichment resolves. Quick-add has to feel instant.
    const task = addTask({ title: trimmed, source: 'manual' })
    broadcastTasks()

    void enrichTask(trimmed).then((enriched) => {
      if (enriched.title === trimmed && enriched.deadline === null) return
      updateTask(task.id, {
        title: enriched.title,
        deadline: enriched.deadline,
        priority: enriched.priority,
        people: enriched.people
      })
      broadcastTasks()
    })
  })

  ipcMain.on(IPC.QuickAddCancel, () => {
    setQuickAddRecording(false)
    hideQuickAdd()
  })

  ipcMain.on(IPC.QuickAddRecording, (_event, next: boolean) => {
    setQuickAddRecording(Boolean(next))
  })

  ipcMain.handle(IPC.TranscribeAudio, async (_event, buffer: ArrayBuffer) => {
    const samples = new Float32Array(buffer)
    return transcribePcm(samples)
  })

  ipcMain.handle(IPC.GetAccountStatus, () => ({
    google: isGoogleConnected(),
    googleEmail: connectedGoogleAccount(),
    credentialsConfigured: loadCredentials() !== null
  }))

  ipcMain.handle(IPC.ConnectGoogle, async () => {
    const result = await connectGoogle()
    trayHandle?.refresh()
    await triggerSync()
    return result
  })

  ipcMain.handle(IPC.DisconnectGoogle, async () => {
    await disconnectGoogle()
    trayHandle?.refresh()
    return { google: false }
  })

  ipcMain.handle(IPC.RunSyncNow, () => triggerSync())

  ipcMain.handle(IPC.GetConfig, () => loadConfig())

  ipcMain.handle(IPC.SetConfig, (_event, patch: Partial<Config>) => {
    const previous = loadConfig()
    const next = saveConfig(patch)
    applyLiveConfig(next, previous)
    return next
  })

  ipcMain.handle(IPC.OpenUserData, () => shell.openPath(app.getPath('userData')))

  ipcMain.handle(IPC.GetRagCount, () => exampleCount(getTaskStore()))

  ipcMain.on(IPC.OpenSettings, () => showSettingsWindow())
}

/**
 * Who the prompts should treat as "me". A connected mailbox is the best signal;
 * failing that the OS account name is a reasonable guess, since screens
 * typically address the user by first name. Replaced by an explicit setting
 * once the settings window exists.
 */
function currentUserName(): string {
  // OS account is usually a real first name ("Suraj"). The Gmail local-part
  // is often a handle, and the extractor then misses mail that says "Hi Suraj".
  const os = userInfo().username?.trim()
  if (os) return os
  const account = connectedGoogleAccount()
  if (account) return account.split('@')[0] ?? account
  return 'the user'
}

/**
 * Reads whatever is on screen and files it as a task. The same entry point
 * serves Ctrl+Shift+S and spoken/typed "add what's on my screen" intents.
 */
async function captureScreenAsTask(instruction = ''): Promise<void> {
  const overlay = getOverlayWindow()
  overlay?.webContents.send(IPC.SyncStatus, { state: 'running' })

  try {
    const result = await screenToTask(instruction, {
      model: loadConfig().ollamaModel,
      userName: currentUserName()
    })
    if (!result) {
      new Notification({
        title: 'AmbientMind',
        body: 'Nothing actionable found on screen.'
      }).show()
      return
    }

    addTask({
      title: result.title,
      deadline: result.deadline,
      priority: result.priority,
      source: 'manual',
      people: result.people,
      // The summary is the whole point: it lets the task be acted on later
      // without going back to whatever was on screen at the time.
      rawContext: result.summary,
      confidence: 1
    })
    broadcastTasks()

    new Notification({ title: result.title, body: result.summary || 'Added from screen' }).show()
  } catch (err) {
    console.error('[screen] failed:', err)
    new Notification({
      title: 'AmbientMind',
      body: `Screen capture failed: ${(err as Error).message}`
    }).show()
  } finally {
    overlay?.webContents.send(IPC.SyncStatus, { state: 'idle' })
  }
}

async function triggerSync(force = true): Promise<SyncReport> {
  getOverlayWindow()?.webContents.send(IPC.SyncStatus, { state: 'running' })
  const report = await runSync(syncOptions(loadConfig(), { force }))
  broadcastTasks()
  getOverlayWindow()?.webContents.send(IPC.SyncStatus, { state: 'idle', report })
  trayHandle?.refresh()

  const summary = report.errors[0]
    ? report.errors[0]
    : `Scanned ${report.scanned}, added ${report.added} task${report.added === 1 ? '' : 's'}`
  new Notification({ title: 'AmbientMind sync', body: summary }).show()
  console.log('[sync] report', report)
  return report
}

function applyProductionCsp() {
  // Applied as a header rather than a meta tag so the dev server's HMR
  // websocket and inline styles are not blocked during development.
  if (!app.isPackaged) return
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': ["default-src 'self'; style-src 'self' 'unsafe-inline'"]
      }
    })
  })
}

function registerShortcut(accelerator: string, fn: () => void) {
  try {
    return globalShortcut.register(accelerator, fn)
  } catch (err) {
    console.warn('[shortcuts] failed to register', accelerator, err)
    return false
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  // The overlay is the whole UI, so there is no dock presence to keep alive.
  app.dock?.hide()

  void app.whenReady().then(() => {
    applyProductionCsp()

    // Mic access is requested from the QuickAdd renderer; without this grant
    // Electron denies getUserMedia even when the OS dialog would allow it.
    session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
      callback(permission === 'media' || permission === 'mediaKeySystem')
    })
    session.defaultSession.setPermissionCheckHandler((_wc, permission) => {
      return permission === 'media' || permission === 'mediaKeySystem'
    })

    openTaskStore()
    if (!app.isPackaged) seedIfEmpty()
    archiveStaleCompleted()
    registerIpc()

    const config = loadConfig()
    createOverlayWindow(config)
    createQuickAddWindow()
    trayHandle = createTray({
      onSyncNow: triggerSync,
      onOpenSettings: () => showSettingsWindow()
    })

    const registered = {
      quickAdd: registerShortcut(QUICK_ADD_SHORTCUT, toggleQuickAdd),
      capture: registerShortcut(CAPTURE_SCREEN_SHORTCUT, () => {
        console.log('[shortcut] screen capture')
        void captureScreenAsTask()
      }),
      settings: registerShortcut(SETTINGS_SHORTCUT, () => showSettingsWindow())
    }
    console.log('[shortcuts]', JSON.stringify(registered))
    startScheduler(config.syncIntervalMinutes, syncOptions(config))

    // First mic use would otherwise stall on a ~75MB model download/load.
    void warmSpeechModel().catch((err) => console.warn('[speech] warm failed:', err))

    setInterval(() => {
      if (archiveStaleCompleted() > 0) broadcastTasks()
    }, ARCHIVE_SWEEP_MS)
  })

  // Tray-resident app: closing a window must not terminate the process.
  app.on('window-all-closed', () => {})

  app.on('will-quit', () => {
    globalShortcut.unregisterAll()
    stopScheduler()
    void disposeScreenContext()
    disposeSpeech()
    closeTaskStore()
  })
}
