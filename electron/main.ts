import { isIsolated } from './isolation'
import { userInfo } from 'node:os'
import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { app, dialog, globalShortcut, ipcMain, Notification, session, shell } from 'electron'
import { IPC } from '@shared/ipc'
import {
  defaultShortcuts,
  findConflicts,
  SHORTCUT_NAMES,
  shortcutLabel,
  type ShortcutAction,
  type ShortcutStatus
} from '@shared/shortcuts'
import { privacySettingsUrl, type MediaKind } from '@shared/permissions'

import { BurstLimiter, guard, setErrorSink } from './services/guard'
import { broadcast } from './broadcast'
import { allowPermission, contentSecurityPolicy, isAppUrl } from './security'
import { hideDock, installAppMenu, os, permissionState } from './platform'

// Windows 11 otherwise paints a gray DWM plate around transparent overlays.
app.commandLine.appendSwitch('enable-transparent-visuals')
app.commandLine.appendSwitch('disable-features', 'EnableTransparentHwndEnlargement')

/** ~/Library/Logs/AmbientMind on the Mac, where Console.app looks. */
function crashLogPath() {
  const dir = app.getPath('logs')
  mkdirSync(dir, { recursive: true })
  return join(dir, 'crash.log')
}

function recordCrash(kind: string, err: unknown) {
  const text = err instanceof Error ? err.stack ?? err.message : String(err)
  const line = `${new Date().toISOString()} [${kind}] ${text}\n`
  console.error(line.trimEnd())
  try {
    appendFileSync(crashLogPath(), line)
  } catch (logErr) {
    console.warn('[crash] could not write crash.log', logErr)
  }
}

setErrorSink((where, err) => recordCrash(where, err))

// One bad message or timer tick used to quit the whole app. Now only a burst
// of failures does, since that means the process is stuck failing.
const crashLoop = new BurstLimiter(3, 60_000)

process.on('uncaughtException', (err) => {
  recordCrash('uncaughtException', err)
  if (!crashLoop.hit()) return
  try {
    dialog.showErrorBox('AmbientMind stopped', `It kept failing, so it quit. ${err.message}`)
  } catch {
    // Dialog is unavailable before app ready; the log is the record.
  }
  app.exit(1)
})

process.on('unhandledRejection', (reason) => {
  recordCrash('unhandledRejection', reason)
})

const reloads = new Map<number, BurstLimiter>()

app.on('render-process-gone', (_event, webContents, details) => {
  recordCrash('render-process-gone', `${details.reason} exit=${details.exitCode}`)
  if (webContents.isDestroyed()) return
  const limiter = reloads.get(webContents.id) ?? new BurstLimiter(3, 60_000)
  reloads.set(webContents.id, limiter)
  // A window that crashes on load would otherwise reload, and alert, forever.
  if (limiter.hit()) {
    try {
      dialog.showErrorBox('AmbientMind', 'A window keeps crashing, so it was left closed.')
    } catch {
      /* ignore */
    }
    return
  }
  webContents.reload()
})

app.on('child-process-gone', (_event, details) => {
  recordCrash('child-process-gone', `${details.type} ${details.reason} exit=${details.exitCode}`)
})
import {
  applyOverlayConfig,
  createOverlayWindow,
  setPanelHeight,
  setOverlayExpanded
} from './overlay'
import {
  createQuickAddWindow,
  hideQuickAdd,
  setQuickAddRecording,
  setQuickAddHeight,
  showQuickAdd,
  toggleQuickAdd
} from './quickAdd'
import { showSettingsWindow } from './settings'
import { createTray } from './tray'
import {
  addTask,
  applyEnrichment,
  archiveStaleCompleted,
  closeTaskStore,
  deleteTask,
  getTask,
  getTaskStore,
  listActive,
  listSyncStates,
  openTaskStore,
  reopenTask,
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
  onRuleChange,
  updateRule,
  type RuleChange,
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
import { writeEncryptedBackup } from './services/backup'
import { loadChatHistory, saveChatHistory } from './services/chatHistory'
import { exampleCount, messageIdFromTask, rateExampleBySource } from './services/vectorStore'
import { backfillEmbeddings, runRetention } from './services/maintenance'
import { parseCapture } from '@shared/capture'
import type { ChatTurn, Config, SyncSummary, Task } from '@shared/types'
import { describePause, isAiPaused } from '@shared/pauseAi'
import { powerMonitor } from 'electron'
import { forgetSubject, learnedSuppressions, recordDecision } from './services/decisionStore'
import {
  removeRuleFromCalendar,
  syncAllRulesToCalendar,
  syncRuleToCalendar
} from './services/calendarSync'
import { showChatWindow } from './chat'
import { runChat } from './services/chat'
import { describeRule, type NewRecurrenceRule } from '@shared/recurrence'
import { seedIfEmpty } from './seedTasks'
import { runSelfTest } from './services/selfTest'

const ARCHIVE_SWEEP_MS = 15 * 60_000
const SNOOZE_SWEEP_MS = 30_000

let trayHandle: { refresh: () => void } | null = null
/** In-memory: the DB keeps last_run/last_error, this keeps the counts. */
let lastReport: SyncSummary['lastReport'] = null

/** `ipcMain.on` with a guard: a throwing handler is logged, not fatal. */
function onIpc<A extends unknown[]>(
  channel: string,
  handler: (event: Electron.IpcMainEvent, ...args: A) => unknown
) {
  ipcMain.on(channel, guard(`ipc:${channel}`, handler) as (event: Electron.IpcMainEvent, ...args: unknown[]) => void)
}

function broadcastTasks() {
  broadcast(IPC.TasksChanged, listActive())
}

/**
 * Closes the feedback loop that migration 002 designed and nothing wrote to.
 *
 * Acting on a task is the cheapest honest signal available about the
 * extraction that produced it: completing it says the model read the mail
 * correctly, deleting it says the model invented work. renderFewShot already
 * replays thumbs-down examples as empty extractions, so a rating teaches the
 * user's own boundary for "not a task" rather than merely hiding a mistake.
 */
function rateSourceExample(task: Task, feedback: -1 | 1) {
  const messageId = messageIdFromTask(task)
  if (!messageId) return
  try {
    rateExampleBySource(getTaskStore(), messageId, feedback)
  } catch (err) {
    console.warn('[rag] rating failed:', (err as Error).message)
  }
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
 * Electron rather than this app. Isolated runs never touch login items.
 */
function applyLoginItem(config: Config) {
  if (!app.isPackaged || isIsolated) return
  app.setLoginItemSettings({
    openAtLogin: config.launchAtLogin,
    // The overlay collapses to the orb and the tray carries the rest, so
    // there is nothing worth showing on a cold boot.
    args: ['--hidden']
  })
}

function applyLiveConfig(config: Config, previous?: Config) {
  applyOverlayConfig(config)
  broadcast(IPC.ConfigChanged, config)
  setSpeechModel(config.whisperModel)
  if (!previous || previous.launchAtLogin !== config.launchAtLogin) applyLoginItem(config)

  // Switching write-back on has to backfill: rules made before today are
  // exactly the ones the user wants on their phone.
  if (config.calendarWriteBack && previous && !previous.calendarWriteBack) {
    void syncAllRulesToCalendar().then((result) => {
      console.log(`[calendar] backfilled ${result.pushed} rule(s)`, result.errors)
    })
  }
  if (!previous || previous.syncIntervalMinutes !== config.syncIntervalMinutes) {
    startScheduler(config.syncIntervalMinutes, () => syncOptions(), onScheduledSync)
  }
}

/** Every rule change, from any entry point, reaches the list and the calendar mirror. */
function handleRuleChange(change: RuleChange) {
  applyRules()
  broadcastTasks()
  trayHandle?.refresh()
  // Not awaited: the calendar is a mirror, and a slow or unreachable Google
  // must never delay the rule appearing in the app.
  if (change.kind === 'deleted') void removeRuleFromCalendar(change.eventId)
  else void syncRuleToCalendar(change.id)
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
  // Calendar reconciliation can move or remove tasks without adding any.
  broadcastTasks()
  broadcast(IPC.SyncStatus, { state: 'idle' })
  trayHandle?.refresh()
}

function registerIpc() {
  onIpc(IPC.SetPanelHeight, (_event, height: number) => setPanelHeight(Number(height)))
  onIpc(IPC.OpenQuickAdd, () => showQuickAdd())
  onIpc(IPC.QuickAddHeight, (_event, height: number) => setQuickAddHeight(Number(height)))

  ipcMain.handle(IPC.SetOverlayExpanded, (_event, expanded: boolean) => {
    setOverlayExpanded(expanded)
  })
  // Older preload used send() instead of invoke(); keep both so a stale
  // renderer can still collapse/expand.
  onIpc(IPC.SetOverlayExpanded, (_event, expanded: boolean) => {
    setOverlayExpanded(expanded)
  })

  ipcMain.handle(IPC.GetTasks, () => listActive())

  ipcMain.handle(IPC.AddTask, (_event, title: string) => {
    addTask({ title, source: 'manual' })
    broadcastTasks()
    return listActive()
  })

  ipcMain.handle(IPC.CompleteTask, (_event, id: string) => {
    // Recorded before the status change, while the task is still readable.
    const task = getTask(id)
    setStatus(id, 'done')
    if (task) {
      recordDecision({ kind: 'completed', title: task.title, source: task.source })
      rateSourceExample(task, 1)
    }
    broadcastTasks()
    trayHandle?.refresh()
    return listActive()
  })

  ipcMain.handle(IPC.DeleteTask, (_event, id: string) => {
    const task = getTask(id)
    deleteTask(id)
    if (task) {
      recordDecision({ kind: 'deleted', title: task.title, source: task.source })
      rateSourceExample(task, -1)
    }
    broadcastTasks()
    trayHandle?.refresh()
    return listActive()
  })

  ipcMain.handle(IPC.ReopenTask, (_event, id: string) => {
    reopenTask(id)
    broadcastTasks()
    trayHandle?.refresh()
    return listActive()
  })

  ipcMain.handle(IPC.AcceptTask, (_event, id: string) => {
    const task = getTask(id)
    if (task?.status === 'suggested') setStatus(id, 'pending')
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
    const task = getTask(id)
    snoozeTask(id, until)
    if (task) {
      recordDecision({
        kind: 'snoozed',
        title: task.title,
        source: task.source,
        detail: until.slice(0, 16).replace('T', ' ')
      })
    }
    broadcastTasks()
    trayHandle?.refresh()
    return listActive()
  })

  onIpc(IPC.QuickAddSubmit, (_event, title: string, options?: { keepOpen?: boolean }) => {
    const trimmed = title.trim()
    if (!options?.keepOpen) hideQuickAdd()
    setQuickAddRecording(false)
    if (!trimmed) return

    const parsed = parseCapture(trimmed)

    // Voice (and typed) "add what's on my screen" routes into the same
    // capture pipeline as the capture shortcut, with the utterance as instruction.
    if (parsed.screen) {
      void captureScreenAsTask(trimmed)
      return
    }

    // "tuition Tue, Thu, Sat at 5pm" is a standing commitment, not one task.
    // Parsed in code rather than by the model: a wrong recurrence repeats.
    if (parsed.recurrence) {
      const rule = addRule({
        title: parsed.recurrence.title,
        weekdays: parsed.recurrence.weekdays,
        time: parsed.recurrence.time,
        priority: 'medium',
        leadMinutes: 0,
        enabled: true,
        source: 'explicit'
      })
      new Notification({ title: `Recurring: ${rule.title}`, body: describeRule(rule) }).show()
      return
    }

    // Insert immediately with what Quick Capture showed as chips, so the
    // overlay never waits on the model; enrichment may tidy the title and
    // fill gaps afterwards, but never overrides what was parsed.
    const task = addTask({
      title: parsed.title,
      deadline: parsed.deadline,
      priority: parsed.priority ?? 'medium',
      people: parsed.people,
      source: 'manual'
    })
    broadcastTasks()

    const config = loadConfig()
    if (isAiPaused(config.pauseAiUntil)) return
    void enrichTask(trimmed, { model: config.ollamaModel }).then((enriched) => {
      const merged = {
        title: enriched.title,
        deadline: parsed.deadline ?? enriched.deadline,
        priority: parsed.priority ?? enriched.priority,
        people: [...new Set([...parsed.people, ...enriched.people])]
      }
      if (merged.title === task.title && merged.deadline === task.deadline && merged.priority === task.priority) return
      if (applyEnrichment(task.id, merged)) broadcastTasks()
    })
  })

  onIpc(IPC.QuickAddCancel, () => {
    setQuickAddRecording(false)
    hideQuickAdd()
  })

  onIpc(IPC.QuickAddRecording, (_event, next: boolean) => {
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

  ipcMain.handle(IPC.RunSyncNow, () => triggerSync(true))

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
    return {
      suggestions: listPendingSuggestions(),
      rules: listRules()
    }
  })

  ipcMain.handle(IPC.DismissSuggestion, (_event, id: string) => {
    const suggestion = listPendingSuggestions().find((entry) => entry.id === id)
    dismissSuggestion(id)
    if (suggestion) {
      recordDecision({ kind: 'dismissed_suggestion', title: suggestion.title, source: 'rule' })
    }
    return listPendingSuggestions()
  })

  ipcMain.handle(IPC.GetLearned, () => learnedSuppressions())

  ipcMain.handle(IPC.ForgetLearned, (_event, title: string) => {
    forgetSubject(title)
    return learnedSuppressions()
  })

  ipcMain.handle(IPC.GetRules, () => listRules())

  ipcMain.handle(IPC.AddRule, (_event, input: NewRecurrenceRule) => {
    const rule = addRule(input)
    return { rule, rules: listRules() }
  })

  ipcMain.handle(IPC.UpdateRule, (_event, id: string, patch: RulePatch) => {
    updateRule(id, patch)
    return listRules()
  })

  ipcMain.handle(IPC.DeleteRule, (_event, id: string) => {
    deleteRule(id)
    return listRules()
  })

  ipcMain.handle(IPC.GetHealth, () => {
    const config = loadConfig()
    return checkHealth({
      ollamaModel: config.ollamaModel,
      embeddingModel: config.embeddingModel,
      calendarWriteBack: config.calendarWriteBack,
      pauseAiUntil: config.pauseAiUntil
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

  ipcMain.handle(IPC.GetShortcuts, () => shortcutStatus)

  ipcMain.handle(IPC.GetPermissions, () => [permissionState('microphone'), permissionState('screen')])

  ipcMain.handle(IPC.OpenPermissionSettings, async (_event, kind: MediaKind) => {
    const url = privacySettingsUrl(kind, os)
    if (url) await shell.openExternal(url)
  })

  ipcMain.handle(IPC.GetAppInfo, () => ({
    version: app.getVersion(),
    userData: app.getPath('userData')
  }))

  ipcMain.handle(IPC.ExportBackup, async (_event, passphrase: string) => {
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: 'Save encrypted backup',
      defaultPath: `ambientmind-backup-${new Date().toISOString().slice(0, 10)}.amb`,
      filters: [{ name: 'AmbientMind backup', extensions: ['amb'] }]
    })
    if (canceled || !filePath) return { canceled: true as const }
    writeEncryptedBackup(filePath, String(passphrase ?? ''))
    return { canceled: false as const, path: filePath }
  })

  ipcMain.handle(IPC.GetChatHistory, () => loadChatHistory())
  ipcMain.handle(IPC.SaveChatHistory, (_event, turns: ChatTurn[]) => saveChatHistory(turns ?? []))

  ipcMain.handle(IPC.GetRagCount, () => exampleCount(getTaskStore()))

  onIpc(IPC.OpenSettings, () => showSettingsWindow())

  onIpc(IPC.OpenChat, () => showChatWindow())

  ipcMain.handle(IPC.ChatSend, async (_event, message: string, history: ChatTurn[]) => {
    const config = loadConfig()
    if (isAiPaused(config.pauseAiUntil) && config.pauseAiUntil) {
      return {
        reply: describePause(config.pauseAiUntil),
        actions: [],
        changed: false
      }
    }
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
  const pausedUntil = loadConfig().pauseAiUntil
  if (isAiPaused(pausedUntil) && pausedUntil) {
    new Notification({ title: 'AmbientMind', body: describePause(pausedUntil) }).show()
    return
  }
  broadcast(IPC.ScreenStatus, { state: 'running' })

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
    // macOS reports "denied" until the first request too, so the capture is
    // always attempted (that is what registers the app) and only explained
    // once it fails.
    const permission = permissionState('screen')
    const url = privacySettingsUrl('screen', os)
    const notice = new Notification({
      title: permission.help ? 'Screen Recording is off' : 'AmbientMind',
      body: permission.help ?? `Screen capture failed: ${(err as Error).message}`
    })
    if (permission.help && url) notice.on('click', () => void shell.openExternal(url))
    notice.show()
  } finally {
    broadcast(IPC.ScreenStatus, { state: 'idle' })
  }
}

/** Only an explicit "Sync now" forces; Connect and wake read new mail only. */
async function triggerSync(force = false): Promise<SyncReport> {
  broadcast(IPC.SyncStatus, { state: 'running' })
  let report: SyncReport
  try {
    report = await runSync(syncOptions(loadConfig(), { force }))
  } catch (err) {
    report = {
      ranAt: new Date().toISOString(),
      scanned: 0,
      skipped: 0,
      extracted: 0,
      added: 0,
      deduped: 0,
      suppressed: 0,
      errors: [`sync: ${(err as Error).message}`]
    }
  } finally {
    broadcast(IPC.SyncStatus, { state: 'idle' })
  }
  lastReport = {
    ranAt: report.ranAt,
    scanned: report.scanned,
    added: report.added,
    errors: report.errors
  }
  broadcastTasks()
  trayHandle?.refresh()

  const summary = report.errors[0]
    ? report.errors[0]
    : `Scanned ${report.scanned}, added ${report.added} task${report.added === 1 ? '' : 's'}`
  if (!isAiPaused(loadConfig().pauseAiUntil)) {
    new Notification({ title: 'AmbientMind sync', body: summary }).show()
  }
  console.log('[sync] report', report)
  return report
}

const devServerUrl = app.isPackaged ? undefined : process.env.ELECTRON_RENDERER_URL

/**
 * Built pages carry their policy as a meta tag (see electron.vite.config.ts),
 * because file:// responses have no headers to rewrite. The dev server's
 * pages get the dev policy here, so CSP problems surface while developing.
 */
function applyDevCsp() {
  if (!devServerUrl) return
  const policy = contentSecurityPolicy(devServerUrl)
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    if (!isAppUrl(details.url, devServerUrl)) return callback({})
    callback({
      responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [policy] }
    })
  })
}

/** Our windows only ever show our pages; links open in the browser. */
function guardNavigation() {
  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-navigate', (event, url) => {
      if (!isAppUrl(url, devServerUrl)) event.preventDefault()
    })
    contents.on('will-attach-webview', (event) => event.preventDefault())
    contents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//.test(url)) void shell.openExternal(url)
      return { action: 'deny' }
    })
  })
}

let shortcutStatus: ShortcutStatus[] = []

/**
 * A known conflict is reported but still registered: the user may have
 * turned the other owner off. Registration fails when another app already
 * holds the keys, and that is reported too, instead of a dead shortcut.
 */
function registerShortcuts(handlers: Record<ShortcutAction, () => void>) {
  const set = defaultShortcuts(os)
  const conflicts = findConflicts(set, os)
  shortcutStatus = (Object.keys(set) as ShortcutAction[]).map((action) => {
    const accelerator = set[action]
    let registered = false
    try {
      registered = globalShortcut.register(accelerator, guard(`shortcut:${action}`, handlers[action]))
    } catch (err) {
      console.warn('[shortcuts] failed to register', accelerator, err)
    }
    return {
      action,
      name: SHORTCUT_NAMES[action],
      accelerator,
      label: shortcutLabel(accelerator, os),
      problem: conflicts[action] ?? (registered ? null : 'Another app is using these keys')
    }
  })
  console.log('[shortcuts]', JSON.stringify(shortcutStatus.map((s) => [s.label, s.problem])))
}

/**
 * Headless corpus export: `electron . --export-corpus`.
 *
 * Deliberately outside the single-instance lock and before any window or store
 * is created. Labelling is a repeatable chore, and the Gmail path touches no
 * database, so this can run while the app itself stays up.
 */
if (process.argv.includes('--selftest')) {
  void app.whenReady().then(async () => {
    const result = await runSelfTest()
    console.log(JSON.stringify(result, null, 2))
    closeTaskStore()
    app.exit(result.ok ? 0 : 1)
  })
} else if (process.argv.includes('--sync-now')) {
  // Headless sync, for scripting and for checking a change against real mail
  // without waiting for the scheduler's next tick. Opens the store, so the
  // app should not be running at the same time.
  void app.whenReady().then(async () => {
    try {
      openTaskStore()
      const config = loadConfig()
      const report = await runSync(syncOptions(config, { force: false }))
      console.log(JSON.stringify(report, null, 2))
      app.exit(report.errors.length > 0 ? 1 : 0)
    } catch (err) {
      console.error('[sync] failed:', (err as Error).message)
      app.exit(1)
    }
  })
} else if (process.argv.includes('--export-corpus')) {
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
  // A menu-bar app: Settings and Chat bring the Dock icon back while open.
  hideDock()

  void app.whenReady().then(() => {
    applyDevCsp()
    guardNavigation()
    installAppMenu({ openSettings: () => showSettingsWindow() })

    // Mic access is requested from the QuickAdd renderer; without this grant
    // Electron denies getUserMedia even when the OS dialog would allow it.
    // Nothing else is granted, and nothing at all to a page that is not ours.
    session.defaultSession.setPermissionRequestHandler((wc, permission, callback, details) => {
      const mediaTypes = 'mediaTypes' in details ? details.mediaTypes : undefined
      callback(
        allowPermission(permission, {
          ...(mediaTypes ? { mediaTypes } : {}),
          url: details.requestingUrl ?? wc.getURL(),
          ...(devServerUrl ? { devServerUrl } : {})
        })
      )
    })
    session.defaultSession.setPermissionCheckHandler((wc, permission, requestingOrigin, details) => {
      const mediaType = 'mediaType' in details ? details.mediaType : undefined
      return allowPermission(permission, {
        ...(mediaType ? { mediaTypes: [mediaType] } : {}),
        url: wc?.getURL() || requestingOrigin,
        ...(devServerUrl ? { devServerUrl } : {})
      })
    })

    openTaskStore()
    if (!app.isPackaged && process.argv.includes('--seed')) seedIfEmpty()
    archiveStaleCompleted()
    // The app may have been shut for longer than a snooze.
    wakeSnoozed()
    materialiseRules()
    refreshSuggestions()
    runRetention()
    onRuleChange(handleRuleChange)
    registerIpc()

    const config = loadConfig()
    applyLoginItem(config)
    // A store holding two embedding conventions ranks neighbours across two
    // slightly different spaces, so this is a repair and should start now
    // rather than at the first sweep. It no-ops once every row agrees.
    void backfillEmbeddings(config.embeddingModel)
    createOverlayWindow(config)
    createQuickAddWindow()
    trayHandle = createTray({
      onSyncNow: () => triggerSync(true),
      onOpenSettings: () => showSettingsWindow(),
      launchAtLogin: () => loadConfig().launchAtLogin,
      setLaunchAtLogin: (on) => {
        const previous = loadConfig()
        applyLiveConfig(saveConfig({ launchAtLogin: on }), previous)
      }
    })

    registerShortcuts({
      quickAdd: toggleQuickAdd,
      capture: () => void captureScreenAsTask(),
      settings: () => showSettingsWindow(),
      chat: () => showChatWindow()
    })
    startScheduler(config.syncIntervalMinutes, () => syncOptions(), onScheduledSync)

    // First mic use would otherwise stall on a model download/load.
    setSpeechModel(config.whisperModel)
    void warmSpeechModel().catch((err) => console.warn('[speech] warm failed:', err))

    // Snoozed tasks are checked far more often than completed ones are swept:
    // a task that reappears 15 minutes late has missed the point of snoozing.
    setInterval(
      guard('timer:snooze-sweep', () => {
        if (wakeSnoozed() > 0) {
          broadcastTasks()
          trayHandle?.refresh()
        }
        // Brings up each rule's next occurrence as the previous one settles.
        applyRules()
      }),
      SNOOZE_SWEEP_MS
    )

    setInterval(
      guard('timer:archive-sweep', async () => {
        if (archiveStaleCompleted() > 0) broadcastTasks()
        // Hourly is plenty: a habit that took three weeks to form will keep.
        refreshSuggestions()
        // Cheap and usually a no-op, but it is the only thing standing between
        // the vector store and unbounded linear growth in retrieval cost.
        runRetention()
        await backfillEmbeddings(loadConfig().embeddingModel)
      }),
      ARCHIVE_SWEEP_MS
    )

    // Closing the lid at night and opening it in the morning is the normal
    // case, not an edge case. Timers do not run while the machine is asleep,
    // so on resume the list is showing yesterday: snoozes that should have
    // returned are still hidden, and mail from overnight has not been read.
    powerMonitor.on(
      'resume',
      guard('power:resume', async () => {
        console.log('[power] resumed; catching up')
        if (wakeSnoozed() > 0) trayHandle?.refresh()
        applyRules()
        broadcastTasks()
        await triggerSync()
      })
    )
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
