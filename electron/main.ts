import { userInfo } from 'node:os'
import { app, globalShortcut, ipcMain, Notification, session, shell } from 'electron'
import {
  CAPTURE_SCREEN_SHORTCUT,
  CHAT_SHORTCUT,
  IPC,
  QUICK_ADD_SHORTCUT,
  SETTINGS_SHORTCUT
} from '@shared/ipc'

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
  listSyncStates,
  openTaskStore,
  setStatus,
  snoozeTask,
  updateTask,
  wakeSnoozed,
  type TaskPatch
} from './services/taskStore'
import { checkHealth } from './services/health'
import { exportCorpus } from './services/corpusExport'
import {
  addRule,
  deleteRule,
  listRules,
  materialiseRules,
  updateRule,
  type RulePatch
} from './services/ruleStore'
import {
  acceptSuggestion,
  dismissSuggestion,
  listPendingSuggestions,
  refreshSuggestions
} from './services/suggestionStore'
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
import {
  disposeSpeech,
  setSpeechModel,
  transcribePcm,
  warmSpeechModel
} from './services/speech'
import { loadConfig, saveConfig } from './services/config'
import { exampleCount } from './services/vectorStore'
import { isScreenCaptureIntent } from '@shared/voiceIntent'
import type { ChatTurn, Config, SyncSummary } from '@shared/types'
import { powerMonitor } from 'electron'
import { showChatWindow } from './chat'
import { runChat } from './services/chat'
import { describeRule, parseRecurrence, type NewRecurrenceRule } from '@shared/recurrence'
import { seedIfEmpty } from './seedTasks'

const ARCHIVE_SWEEP_MS = 15 * 60_000
const SNOOZE_SWEEP_MS = 30_000

let trayHandle: { refresh: () => void } | null = null
/** In-memory: the DB keeps last_run/last_error, this keeps the counts. */
let lastReport: SyncSummary['lastReport'] = null

function broadcastTasks() {
  getOverlayWindow()?.webContents.send(IPC.TasksChanged, listActive())
}

function syncOptions(config: Config = loadConfig(), extra: { force?: boolean } = {}) {
  const email = connectedGoogleAccount()
  return {
    model: config.ollamaModel,
    embeddingModel: config.embeddingModel,
    userName: currentUserName(),
    ...(config.aboutMe ? { aboutMe: config.aboutMe } : {}),
    ...(email ? { userEmail: email } : {}),
    ...extra
  }
}

/**
 * Only meaningful once packaged. In development the executable is Electron
 * itself, so registering would add a startup entry that launches a bare
 * Electron rather than this app.
 */
function applyLoginItem(config: Config) {
  if (!app.isPackaged) return
  app.setLoginItemSettings({
    openAtLogin: config.launchAtLogin,
    // The overlay collapses to the orb and the tray carries the rest, so
    // there is nothing worth showing on a cold boot.
    args: ['--hidden']
  })
}

function applyLiveConfig(config: Config, previous?: Config) {
  applyOverlayConfig(config)
  getOverlayWindow()?.webContents.send(IPC.ConfigChanged, config)
  setSpeechModel(config.whisperModel)
  applyLoginItem(config)
  if (
    !previous ||
    previous.syncIntervalMinutes !== config.syncIntervalMinutes ||
    previous.ollamaModel !== config.ollamaModel ||
    previous.embeddingModel !== config.embeddingModel
  ) {
    startScheduler(config.syncIntervalMinutes, syncOptions(config), onScheduledSync)
  }
}

/** Rules only become visible once their next occurrences exist as tasks. */
function applyRules() {
  const { created, removed } = materialiseRules()
  if (created > 0 || removed > 0) {
    broadcastTasks()
    trayHandle?.refresh()
  }
  return { created, removed }
}

/** A background pass still has to reach the overlay and the status surfaces. */
function onScheduledSync(report: SyncReport) {
  lastReport = {
    ranAt: report.ranAt,
    scanned: report.scanned,
    added: report.added,
    errors: report.errors
  }
  if (report.added > 0) broadcastTasks()
  getOverlayWindow()?.webContents.send(IPC.SyncStatus, { state: 'idle', report })
  trayHandle?.refresh()
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
    trayHandle?.refresh()
    return listActive()
  })

  ipcMain.handle(IPC.DeleteTask, (_event, id: string) => {
    deleteTask(id)
    broadcastTasks()
    trayHandle?.refresh()
    return listActive()
  })

  ipcMain.handle(IPC.UpdateTask, (_event, id: string, patch: TaskPatch) => {
    updateTask(id, patch)
    broadcastTasks()
    return listActive()
  })

  ipcMain.handle(IPC.SnoozeTask, (_event, id: string, until: string) => {
    snoozeTask(id, until)
    broadcastTasks()
    trayHandle?.refresh()
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

    // "tuition Tue, Thu, Sat at 5pm" is a standing commitment, not one task.
    // Parsed in code rather than by the model: a wrong recurrence repeats.
    const recurrence = parseRecurrence(trimmed)
    if (recurrence) {
      const rule = addRule({
        title: recurrence.title,
        weekdays: recurrence.weekdays,
        time: recurrence.time,
        priority: 'medium',
        leadMinutes: 0,
        enabled: true,
        source: 'explicit'
      })
      const { created } = applyRules()
      new Notification({
        title: `Recurring: ${rule.title}`,
        body: `${describeRule(rule)} · ${created} upcoming added`
      }).show()
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

  ipcMain.handle(IPC.GetSuggestions, () => listPendingSuggestions())

  ipcMain.handle(IPC.AcceptSuggestion, (_event, id: string) => {
    acceptSuggestion(id)
    applyRules()
    return {
      suggestions: listPendingSuggestions(),
      rules: listRules()
    }
  })

  ipcMain.handle(IPC.DismissSuggestion, (_event, id: string) => {
    dismissSuggestion(id)
    return listPendingSuggestions()
  })

  ipcMain.handle(IPC.GetRules, () => listRules())

  ipcMain.handle(IPC.AddRule, (_event, input: NewRecurrenceRule) => {
    const rule = addRule(input)
    applyRules()
    return { rule, rules: listRules() }
  })

  ipcMain.handle(IPC.UpdateRule, (_event, id: string, patch: RulePatch) => {
    updateRule(id, patch)
    applyRules()
    return listRules()
  })

  ipcMain.handle(IPC.DeleteRule, (_event, id: string) => {
    deleteRule(id)
    broadcastTasks()
    trayHandle?.refresh()
    return listRules()
  })

  ipcMain.handle(IPC.GetHealth, () => {
    const config = loadConfig()
    return checkHealth({
      ollamaModel: config.ollamaModel,
      embeddingModel: config.embeddingModel
    })
  })

  ipcMain.handle(IPC.GetSyncSummary, (): SyncSummary => {
    const states = listSyncStates()
    const lastRun = states
      .map((s) => s.lastRun)
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1) ?? null
    return {
      lastRun,
      lastError: states.find((s) => s.lastError)?.lastError ?? null,
      lastReport
    }
  })

  ipcMain.handle(IPC.ExportCorpus, async () => {
    const config = loadConfig()
    return exportCorpus({
      model: config.ollamaModel,
      userName: currentUserName(),
      ...(config.aboutMe ? { aboutMe: config.aboutMe } : {})
    })
  })

  ipcMain.handle(IPC.OpenUserData, () => shell.openPath(app.getPath('userData')))

  ipcMain.handle(IPC.GetRagCount, () => exampleCount(getTaskStore()))

  ipcMain.on(IPC.OpenSettings, () => showSettingsWindow())

  ipcMain.on(IPC.OpenChat, () => showChatWindow())

  ipcMain.handle(IPC.ChatSend, async (_event, message: string, history: ChatTurn[]) => {
    const config = loadConfig()
    const reply = await runChat(message, history ?? [], {
      model: config.ollamaModel,
      userName: currentUserName(),
      ...(config.aboutMe ? { aboutMe: config.aboutMe } : {}),
      rules: listRules()
    })
    if (reply.changed) {
      applyRules()
      broadcastTasks()
      trayHandle?.refresh()
    }
    return reply
  })
}

/**
 * Who the prompts should treat as "me". A connected mailbox is the best signal;
 * failing that the OS account name is a reasonable guess, since screens
 * typically address the user by first name. Replaced by an explicit setting
 * once the settings window exists.
 */
function currentUserName(): string {
  // An explicit setting wins: only the user knows what their mail calls them.
  const configured = loadConfig().displayName.trim()
  if (configured) return configured

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
    const config = loadConfig()
    const result = await screenToTask(instruction, {
      model: config.ollamaModel,
      userName: currentUserName(),
      ...(config.aboutMe ? { aboutMe: config.aboutMe } : {})
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
  lastReport = {
    ranAt: report.ranAt,
    scanned: report.scanned,
    added: report.added,
    errors: report.errors
  }
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

/**
 * Headless corpus export: `electron . --export-corpus`.
 *
 * Deliberately outside the single-instance lock and before any window or store
 * is created. Labelling is a repeatable chore, and the Gmail path touches no
 * database, so this can run while the app itself stays up.
 */
if (process.argv.includes('--export-corpus')) {
  void app.whenReady().then(async () => {
    try {
      const config = loadConfig()
      if (!isGoogleConnected()) {
        console.error('Google is not connected. Connect it in Settings first.')
        return app.exit(1)
      }

      const numeric = (flag: string) => {
        const arg = process.argv.find((value) => value.startsWith(`--${flag}=`))
        return arg ? Number(arg.split('=')[1]) : undefined
      }
      const limit = numeric('limit')
      const days = numeric('days')

      const result = await exportCorpus({
        model: config.ollamaModel,
        userName: currentUserName(),
        ...(config.aboutMe ? { aboutMe: config.aboutMe } : {}),
        ...(limit ? { limit } : {}),
        ...(days ? { days } : {}),
        onProgress: (done, total) => console.log(`[corpus] ${done}/${total}`)
      })
      console.log(
        `[corpus] wrote ${result.messages} messages, ${result.prefilledTasks} draft tasks, ${result.skipped} pre-filtered`
      )
      console.log(`[corpus] ${result.path}`)
      console.log(`[corpus] filtered-out mail, for auditing: ${result.filteredPath}`)
      app.exit(0)
    } catch (err) {
      console.error('[corpus] failed:', (err as Error).message)
      app.exit(1)
    }
  })
} else if (!app.requestSingleInstanceLock()) {
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
    // The app may have been shut for longer than a snooze.
    wakeSnoozed()
    materialiseRules()
    refreshSuggestions()
    registerIpc()

    const config = loadConfig()
    applyLoginItem(config)
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
      settings: registerShortcut(SETTINGS_SHORTCUT, () => showSettingsWindow()),
      chat: registerShortcut(CHAT_SHORTCUT, () => showChatWindow())
    }
    console.log('[shortcuts]', JSON.stringify(registered))
    startScheduler(config.syncIntervalMinutes, syncOptions(config), onScheduledSync)

    // First mic use would otherwise stall on a model download/load.
    setSpeechModel(config.whisperModel)
    void warmSpeechModel().catch((err) => console.warn('[speech] warm failed:', err))

    // Snoozed tasks are checked far more often than completed ones are swept:
    // a task that reappears 15 minutes late has missed the point of snoozing.
    setInterval(() => {
      if (wakeSnoozed() > 0) {
        broadcastTasks()
        trayHandle?.refresh()
      }
      // Keeps the rolling horizon topped up as days pass.
      applyRules()
    }, SNOOZE_SWEEP_MS)

    setInterval(() => {
      if (archiveStaleCompleted() > 0) broadcastTasks()
      // Hourly is plenty: a habit that took three weeks to form will keep.
      refreshSuggestions()
    }, ARCHIVE_SWEEP_MS)

    // Closing the lid at night and opening it in the morning is the normal
    // case, not an edge case. Timers do not run while the machine is asleep,
    // so on resume the list is showing yesterday: snoozes that should have
    // returned are still hidden, and mail from overnight has not been read.
    powerMonitor.on('resume', () => {
      console.log('[power] resumed; catching up')
      if (wakeSnoozed() > 0) trayHandle?.refresh()
      applyRules()
      broadcastTasks()
      void triggerSync()
    })
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
