import { isIsolated } from './isolation'
import { qaControl, qaEnabled } from './qa'
import { userInfo } from 'node:os'
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { qaFolderAllowed } from '@shared/qaPolicy'
import { app, BrowserWindow, dialog, globalShortcut, ipcMain, nativeTheme, Notification, session, shell } from 'electron'
import { IPC } from '@shared/ipc'
import {
  findConflicts,
  macHotkey,
  resolveShortcuts,
  SHORTCUT_NAMES,
  shortcutLabel,
  type ShortcutAction,
  type ShortcutStatus
} from '@shared/shortcuts'
import { permissionKinds, privacySettingsUrl, type PermissionKind } from '@shared/permissions'

import { BurstLimiter, guard, setErrorSink } from './services/guard'
import { broadcast } from './broadcast'
import { allowPermission, contentSecurityPolicy, isAppUrl } from './security'
import { accountFullName, hideDock, installAppMenu, os, permissionState, requestAccess, setAppIdentity } from './platform'
import type { HelperMethod } from '@shared/helperProtocol'
import { helperReady, helperRequest, onHelperEvent, onHelperState, startHelper, stopHelper } from './native/helper'
import { runHelperCheck } from './native/helperCheck'

// Windows 11 otherwise paints a gray DWM plate around transparent overlays.
app.commandLine.appendSwitch('enable-transparent-visuals')
// A second disable-features replaces the first, so keep any set before this.
const disabledFeatures = app.commandLine.getSwitchValue('disable-features')
app.commandLine.appendSwitch('disable-features', [disabledFeatures, 'EnableTransparentHwndEnlargement'].filter(Boolean).join(','))

/** ~/Library/Logs/AmbientMind on the Mac, where Console.app looks. */
function crashLogPath() {
  const dir = app.getPath('logs')
  mkdirSync(dir, { recursive: true })
  return join(dir, 'crash.log')
}

if (process.argv.includes(ERASE_FLAG)) eraseUserData(app.getPath('userData'), crashLogPath())

/** Restarts without the erase flag, which must act once only. */
function relaunch() {
  app.relaunch({ args: process.argv.slice(1).filter((arg) => arg !== ERASE_FLAG) })
}

async function confirmDestructive(message: string, detail: string, action: string): Promise<boolean> {
  const options = { type: 'warning' as const, buttons: [action, 'Cancel'], defaultId: 1, cancelId: 1, message, detail }
  const parent = getSettingsWindow()
  const { response } = parent && !parent.isDestroyed() ? await dialog.showMessageBox(parent, options) : await dialog.showMessageBox(options)
  return response === 0
}

function dataInventory(): DataInventory {
  const userData = app.getPath('userData')
  return {
    ...storedCounts(getTaskStore()),
    chatTurns: loadChatHistory().length,
    aiCalls: readCalls(join(userData, 'ai-calls.jsonl')).length,
    networkRequests: readRequests(networkLogPath()).length,
    dataFolder: userData
  }
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
  getOverlayWindow,
  setPanelHeight,
  setOverlayExpanded,
  isOverlayExpanded
} from './overlay'
import {
  createQuickAddWindow,
  getQuickAddWindow,
  hideQuickAdd,
  setQuickAddRecording,
  setQuickAddHeight,
  isQuickAddRecording,
  showQuickAdd,
  toggleQuickAdd
} from './quickAdd'
import { describeQuiet, quietReason, type QuietReason } from '@shared/quiet'
import { HoldGesture } from './holdGesture'
import { getSettingsWindow, showSettingsWindow } from './settings'
import { createTray } from './tray'
import {
  addTask,
  applyEnrichment,
  archiveStaleCompleted,
  closeTaskStore,
  deleteTask,
  getTask,
  markAlerted,
  remindAgainAt,
  tasksToAlert,
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
import { enrichTask } from './services/extract'
import { configureAi } from './services/ai'
import { openAiLog, readCalls } from './services/aiLog'
import { clearNetworkLog, installNetworkLog, networkLogPath, networkSummary, readRequests } from './services/netLog'
import { helperAppleModel } from './services/appleModel'
import {
  connectGoogle,
  connectedGoogleAccount,
  disconnectGoogle,
  googleFetch,
  isGoogleConnected,
  loadCredentials
} from './services/googleAuth'
import { runSync, startScheduler, stopScheduler, type SyncReport } from './services/sync'
import { disposeScreenContext, ScreenRefused, screenToTask } from './services/screenContext'
import { disposeSpeech, setSpeechModel, transcribePcm } from './services/speech'
import {
  cancelLiveSpeech,
  initLiveSpeech,
  installAppleSpeech,
  speechEngine,
  startLiveSpeech,
  stopLiveSpeech
} from './services/liveSpeech'
import { loadConfig, saveConfig } from './services/config'
import {
  appleSourcesStatus,
  initAppleSources,
  noteLocalTaskChange,
  setAppleSource,
  syncAppleCalendar,
  type AppleSource
} from './services/appleSources'
import { RestoreError, restoreEncryptedBackup, writeEncryptedBackup } from './services/backup'
import { ERASE_FLAG, eraseUserData } from './services/eraseData'
import { dropLinesBefore, exportRows, forgetBefore, forgetSource, storedCounts } from './services/inventory'
import { cutoffFor, INVENTORY_SOURCE_LABEL, isErasableSource, type DataInventory } from '@shared/privacy'
import { isLegalDoc, LEGAL_DOCS } from '@shared/legal'
import { loadChatHistory, saveChatHistory } from './services/chatHistory'
import { exampleCount, messageIdFromTask, rateExampleBySource } from './services/vectorStore'
import { backfillEmbeddings, runRetention } from './services/maintenance'
import { needsEnrichment, parseCapture } from '@shared/capture'
import type { ChatReply, ChatTurn, Config, SyncSummary, Task } from '@shared/types'
import { alertBody, MAX_ALERTS_AT_ONCE } from '@shared/dueAlerts'
import { describePause, isAiPaused } from '@shared/pauseAi'
import { powerMonitor } from 'electron'
import { forgetSubject, learnedSuppressions, recordDecision } from './services/decisionStore'
import {
  removeRuleFromCalendar,
  syncAllRulesToCalendar,
  syncRuleToCalendar
} from './services/calendarSync'
import { getChatWindow, showChatWindow } from './chat'
import { getOnboardingWindow, showOnboardingWindow } from './onboarding'
import { runChat } from './services/chat'
import { describeRule, type NewRecurrenceRule } from '@shared/recurrence'
import { seedIfEmpty } from './seedTasks'
import { runSelfTest } from './services/selfTest'

const ARCHIVE_SWEEP_MS = 15 * 60_000
const SNOOZE_SWEEP_MS = 30_000

let trayHandle: { refresh: () => void } | null = null
const QUIET_POLL_MS = 15_000
let quiet: { reason: QuietReason; label: string } | null = null
let overlayHiddenForQuiet = false
let quietTimer: ReturnType<typeof setInterval> | null = null
let wasPaused = false
let lastNotifiedError: string | null = null
/** In-memory: the DB keeps last_run/last_error, this keeps the counts. */
let lastReport: SyncSummary['lastReport'] = null

/** `ipcMain.on` with a guard: a throwing handler is logged, not fatal. */
function onIpc<A extends unknown[]>(
  channel: string,
  handler: (event: Electron.IpcMainEvent, ...args: A) => unknown
) {
  ipcMain.on(channel, guard(`ipc:${channel}`, handler) as (event: Electron.IpcMainEvent, ...args: unknown[]) => void)
}

function completeTaskById(id: string) {
  // Recorded before the status change, while the task is still readable.
  const task = getTask(id)
  setStatus(id, 'done')
  if (task) {
    recordDecision({ kind: 'completed', title: task.title, source: task.source })
    rateSourceExample(task, 1)
  }
  broadcastTasks()
  trayHandle?.refresh()
}

function snoozeTaskById(id: string, until: string) {
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
}

/** Held by reference: a collected notification loses its click and action handlers. */
const liveNotices = new Set<Notification>()

function showDueAlert(task: Task) {
  const notice = new Notification({
    title: task.title,
    body: alertBody(task.deadline ?? new Date().toISOString(), Date.now()),
    actions: [
      { type: 'button', text: 'Done' },
      { type: 'button', text: 'Snooze 1 hour' }
    ],
    closeButtonText: 'Close'
  })
  liveNotices.add(notice)
  const forget = () => liveNotices.delete(notice)
  notice.on('action', (details) => {
    if (details.actionIndex === 0) completeTaskById(task.id)
    if (details.actionIndex === 1) {
      const until = new Date(Date.now() + 3_600_000).toISOString()
      snoozeTaskById(task.id, until)
      remindAgainAt(task.id, until)
    }
    forget()
  })
  notice.on('click', () => {
    setOverlayExpanded(true)
    forget()
  })
  notice.on('close', forget)
  notice.show()
}

/** Not AI, so a pause doesn't hold them; a call or a full-screen app does. */
function sendDueAlerts() {
  const { remindBeforeMinutes } = loadConfig()
  if (remindBeforeMinutes === null || quiet || !Notification.isSupported()) return
  for (const task of tasksToAlert(Date.now(), remindBeforeMinutes).slice(0, MAX_ALERTS_AT_ONCE)) {
    markAlerted(task.id)
    showDueAlert(task)
  }
}

function broadcastTasks() {
  broadcast(IPC.TasksChanged, listActive())
  noteLocalTaskChange()
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
    embeddingModel: config.embeddingModel,
    userName: currentUserName(),
    autoAcceptAbove: config.autoAcceptAbove,
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

function applyContentProtection(on: boolean) {
  for (const win of BrowserWindow.getAllWindows()) win.setContentProtection(on)
}

/** The orb steps aside and sync notifications wait while on a call or in a full-screen app. */
function setQuiet(next: typeof quiet) {
  const changed = (next?.reason ?? null) !== (quiet?.reason ?? null)
  quiet = next
  if (!changed) return
  const overlay = getOverlayWindow()
  if (next && overlay?.isVisible()) {
    overlay.hide()
    overlayHiddenForQuiet = true
  } else if (!next && overlayHiddenForQuiet) {
    overlayHiddenForQuiet = false
    overlay?.showInactive()
  }
  trayHandle?.refresh()
}

async function checkQuiet() {
  if (!loadConfig().quietMode || !helperReady()) return setQuiet(null)
  try {
    const busy = await helperRequest('system.busy', {})
    const reason = quietReason(busy, isQuickAddRecording())
    setQuiet(reason ? { reason, label: describeQuiet(reason, busy) } : null)
  } catch (err) {
    // A restarting helper keeps the last state rather than flickering the orb.
    console.warn('[quiet] could not ask the helper:', (err as Error).message)
  }
}

/** Polls only while quiet mode is on; off, nothing runs. */
function syncQuietWatch(enabled: boolean) {
  if (os !== 'mac') return
  if (!enabled) {
    if (quietTimer) clearInterval(quietTimer)
    quietTimer = null
    setQuiet(null)
    return
  }
  if (quietTimer) return
  quietTimer = setInterval(() => void checkQuiet(), QUIET_POLL_MS)
  void checkQuiet()
}

function applyLiveConfig(config: Config, previous?: Config) {
  applyOverlayConfig(config)
  if (!previous || previous.contentProtection !== config.contentProtection) applyContentProtection(config.contentProtection)
  if (previous && previous.quietMode !== config.quietMode) syncQuietWatch(config.quietMode)
  trayHandle?.refresh()
  nativeTheme.themeSource = config.theme
  if (previous && JSON.stringify(previous.shortcuts) !== JSON.stringify(config.shortcuts)) registerShortcuts()
  broadcast(IPC.ConfigChanged, config)
  setSpeechModel(config.whisperModel)
  configureAi({ preference: config.aiEngine, ollamaModel: config.ollamaModel })
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
  // Google's events are now known, so Apple Calendar can drop its copies.
  void syncAppleCalendar()
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
  ipcMain.handle(IPC.GetOverlayExpanded, () => isOverlayExpanded())
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
    completeTaskById(id)
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
    snoozeTaskById(id, until)
    return listActive()
  })

  onIpc(IPC.QuickAddSubmit, (_event, title: string, options?: { keepOpen?: boolean; spoken?: boolean }) => {
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
      source: options?.spoken ? 'voice' : 'manual'
    })
    broadcastTasks()

    const config = loadConfig()
    if (isAiPaused(config.pauseAiUntil) || !needsEnrichment(parsed)) return
    void enrichTask(trimmed).then((enriched) => {
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

  ipcMain.handle(IPC.SpeechEngine, () => speechEngine())
  ipcMain.handle(IPC.SpeechInstall, () => installAppleSpeech())
  ipcMain.handle(IPC.SpeechStart, () => startLiveSpeech(currentUserName()))
  ipcMain.handle(IPC.SpeechStop, () => stopLiveSpeech())
  onIpc(IPC.SpeechCancel, () => cancelLiveSpeech())

  ipcMain.handle(IPC.GetAccountStatus, () => ({
    google: isGoogleConnected(),
    googleEmail: connectedGoogleAccount(),
    credentialsConfigured: loadCredentials() !== null
  }))

  ipcMain.handle(IPC.ConnectGoogle, async () => {
    const result = await connectGoogle()
    trayHandle?.refresh()
    // The first sync can take minutes; the orb shows it, the caller shouldn't wait.
    void triggerSync()
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
      pauseAiUntil: config.pauseAiUntil,
      aiEngine: config.aiEngine,
      lastSyncError: listSyncStates().find((s) => s.lastError)?.lastError ?? null
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
      userName: currentUserName(),
      ...(config.aboutMe ? { aboutMe: config.aboutMe } : {})
    })
  })

  ipcMain.handle(IPC.OpenUserData, () => shell.openPath(app.getPath('userData')))

  ipcMain.handle(IPC.GetShortcuts, () => shortcutStatus)
  // While Settings records a shortcut, the current ones must not fire.
  onIpc(IPC.SuspendShortcuts, (_event, suspended: boolean) => (suspended ? unregisterShortcuts() : registerShortcuts()))

  ipcMain.handle(IPC.GetPermissions, () => permissionKinds(os).map(permissionState))

  ipcMain.handle(IPC.AppleSources, () => appleSourcesStatus())
  ipcMain.handle(IPC.SetAppleSource, async (_event, source: AppleSource, on: boolean) => {
    if (source !== 'calendar' && source !== 'reminders') throw new Error(`Unknown source ${String(source)}`)
    await setAppleSource(source, on === true, (patch) => {
      const previous = loadConfig()
      applyLiveConfig(saveConfig(patch), previous)
    })
    return appleSourcesStatus()
  })

  ipcMain.handle(IPC.OpenPermissionSettings, async (_event, kind: PermissionKind) => {
    if (!permissionKinds(os).includes(kind)) return
    const url = privacySettingsUrl(kind, os)
    if (url) await shell.openExternal(url)
  })

  ipcMain.handle(IPC.RequestPermission, async (_event, kind: PermissionKind) => {
    if (!permissionKinds(os).includes(kind)) throw new Error(`Unknown permission ${String(kind)}`)
    await requestAccess(kind)
    return permissionState(kind)
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

  ipcMain.handle(IPC.RestoreBackup, async (_event, passphrase: string) => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: 'Restore from backup',
      properties: ['openFile'],
      filters: [{ name: 'AmbientMind backup', extensions: ['amb'] }]
    })
    const file = filePaths[0]
    if (canceled || !file) return { canceled: true as const }
    const sure = await confirmDestructive(
      'Replace your tasks with this backup?',
      'Everything AmbientMind has now is swapped for the backup’s copy; the current database is kept beside it as ambientmind.before-restore.db. AmbientMind restarts.',
      'Restore and Restart'
    )
    if (!sure) return { canceled: true as const }
    try {
      restoreEncryptedBackup(file, String(passphrase ?? ''))
    } catch (err) {
      // The database is still open when the backup is refused.
      if (err instanceof RestoreError) throw err
      openTaskStore()
      throw err
    }
    relaunch()
    app.exit(0)
    return { canceled: true as const }
  })

  ipcMain.handle(IPC.EraseAllData, async () => {
    const sure = await confirmDestructive(
      'Erase everything AmbientMind keeps?',
      'Google is disconnected, and every task, recurring rule, decision, past mail, chat, log, setting and downloaded model on this computer is deleted. AmbientMind restarts as new. Your Reminders, your calendars, events already in your Google AmbientMind calendar, and backups you saved are not touched.',
      'Erase and Restart'
    )
    if (!sure) return { canceled: true as const }
    await disconnectGoogle().catch((err) => console.warn('[erase] could not revoke Google access:', (err as Error).message))
    app.relaunch({ args: [...process.argv.slice(1).filter((arg) => arg !== ERASE_FLAG), ERASE_FLAG] })
    // QA records the relaunch; quitting would end the run it is part of.
    if (!qaEnabled) app.exit(0)
    return { canceled: false as const }
  })

  ipcMain.handle(IPC.OpenCrashLog, async () => {
    const path = crashLogPath()
    if (!existsSync(path) || !readFileSync(path, 'utf8').trim()) return false
    await shell.openPath(path)
    return true
  })

  ipcMain.handle(IPC.OpenLegal, async (_event, doc: unknown) => {
    if (!isLegalDoc(doc)) throw new Error(`Unknown document ${String(doc)}`)
    const path = app.isPackaged ? join(process.resourcesPath, 'legal', LEGAL_DOCS[doc]) : join(app.getAppPath(), LEGAL_DOCS[doc])
    // Nothing may be set to open Markdown; Finder can still show the file.
    if (await shell.openPath(path)) shell.showItemInFolder(path)
  })

  ipcMain.handle(IPC.DataInventory, () => dataInventory())

  ipcMain.handle(IPC.ForgetSource, async (_event, source: unknown) => {
    if (!isErasableSource(source)) throw new Error(`Unknown source ${String(source)}`)
    const label = INVENTORY_SOURCE_LABEL[source]
    const sure = await confirmDestructive(
      `Forget everything from ${label}?`,
      source === 'gmail'
        ? 'Its tasks, the decisions made about them, and the past mail kept to guide the model are removed. While Gmail stays connected, new mail is still read.'
        : `Its tasks and the decisions made about them are removed.`,
      'Forget'
    )
    if (!sure) return { canceled: true, removed: 0 }
    const removed = forgetSource(getTaskStore(), source)
    broadcastTasks()
    trayHandle?.refresh()
    return { canceled: false, removed }
  })

  ipcMain.handle(IPC.ForgetBefore, async (_event, days: unknown) => {
    const age = Number(days)
    if (!Number.isFinite(age) || age < 1) throw new Error('A number of days is needed')
    const cutoff = cutoffFor(age)
    const sure = await confirmDestructive(
      `Forget what’s older than ${new Date(cutoff).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}?`,
      'Finished and deleted tasks, read-mail records, decisions, past mail kept to guide the model, and log entries from before then. Your open tasks and recurring rules stay.',
      'Forget'
    )
    if (!sure) return { canceled: true, removed: 0 }
    const userData = app.getPath('userData')
    const removed =
      forgetBefore(getTaskStore(), cutoff) +
      dropLinesBefore(join(userData, 'ai-calls.jsonl'), cutoff) +
      dropLinesBefore(networkLogPath(), cutoff)
    broadcastTasks()
    return { canceled: false, removed }
  })

  ipcMain.handle(IPC.ClearChatHistory, async () => {
    const sure = await confirmDestructive('Clear the chat history?', 'Past questions and answers are removed. Tasks the chat added stay.', 'Clear')
    if (!sure) return { canceled: true, removed: 0 }
    const removed = loadChatHistory().length
    saveChatHistory([])
    getChatWindow()?.webContents.reload()
    return { canceled: false, removed }
  })

  ipcMain.handle(IPC.ClearAiLog, async () => {
    const sure = await confirmDestructive('Clear the AI call log?', 'It records which engine answered and how long it took, never what was asked.', 'Clear')
    if (!sure) return { canceled: true, removed: 0 }
    const path = join(app.getPath('userData'), 'ai-calls.jsonl')
    const removed = readCalls(path).length
    if (existsSync(path)) writeFileSync(path, '')
    return { canceled: false, removed }
  })

  ipcMain.handle(IPC.ExportData, async () => {
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: 'Export your data',
      defaultPath: `ambientmind-export-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (canceled || !filePath) return { canceled: true as const }
    const exported = {
      exportedAt: new Date().toISOString(),
      app: { name: 'AmbientMind', version: app.getVersion() },
      ...exportRows(getTaskStore()),
      neverSuggest: learnedSuppressions(),
      chatHistory: loadChatHistory(),
      settings: loadConfig()
    }
    writeFileSync(filePath, `${JSON.stringify(exported, null, 2)}\n`)
    return { canceled: false as const, path: filePath }
  })

  ipcMain.handle(IPC.NetworkLog, () => networkSummary())

  ipcMain.handle(IPC.ClearNetworkLog, async () => {
    const sure = await confirmDestructive('Clear the network log?', `The list of requests that left ${os === 'mac' ? 'this Mac' : 'this PC'} starts again from now.`, 'Clear')
    if (!sure) return { canceled: true, removed: 0 }
    const removed = readRequests(networkLogPath()).length
    clearNetworkLog()
    return { canceled: false, removed }
  })

  ipcMain.handle(IPC.GetChatHistory, () => loadChatHistory())
  ipcMain.handle(IPC.SaveChatHistory, (_event, turns: ChatTurn[]) => saveChatHistory(turns ?? []))

  ipcMain.handle(IPC.GetRagCount, () => exampleCount(getTaskStore()))

  onIpc(IPC.OpenSettings, () => showSettingsWindow())
  onIpc(IPC.OpenOnboarding, () => showOnboardingWindow())
  onIpc(IPC.FinishOnboarding, () => {
    const previous = loadConfig()
    applyLiveConfig(saveConfig({ onboarded: true }), previous)
    getOnboardingWindow()?.close()
  })

  onIpc(IPC.OpenChat, () => showChatWindow())
  onIpc(IPC.CloseChat, () => getChatWindow()?.close())

  ipcMain.handle(IPC.ChatSend, async (_event, message: string, history: ChatTurn[]): Promise<ChatReply> => {
    const config = loadConfig()
    if (isAiPaused(config.pauseAiUntil) && config.pauseAiUntil) {
      return {
        reply: describePause(config.pauseAiUntil),
        actions: [],
        changed: false
      }
    }
    chatAbort?.abort()
    const controller = new AbortController()
    chatAbort = controller
    try {
      const reply = await runChat(message, history ?? [], {
        userName: currentUserName(),
        ...(config.aboutMe ? { aboutMe: config.aboutMe } : {}),
        rules: listRules(),
        signal: controller.signal
      })
      if (reply.changed) {
        applyRules()
        broadcastTasks()
        trayHandle?.refresh()
      }
      return reply
    } catch (err) {
      if (!controller.signal.aborted) throw err
      // Stopped mid-answer: anything already changed is real, so show it.
      broadcastTasks()
      trayHandle?.refresh()
      return { reply: '', actions: [], changed: false, stopped: true }
    } finally {
      if (chatAbort === controller) chatAbort = null
    }
  })

  onIpc(IPC.ChatStop, () => chatAbort?.abort())
}

let chatAbort: AbortController | null = null

/**
 * Who the prompts should treat as "me". A connected mailbox is the best signal;
 * failing that the OS account name is a reasonable guess, since screens
 * typically address the user by first name. Replaced by an explicit setting
 * once the settings window exists.
 */
let accountName: string | null | undefined
function accountFirstName(): string | null {
  // No full name on the account falls through to the short one.
  if (accountName === undefined) accountName = accountFullName()?.split(/\s+/)[0] || null
  return accountName
}

function currentUserName(): string {
  // An explicit setting wins: only the user knows what their mail calls them.
  const configured = loadConfig().displayName.trim()
  if (configured) return configured

  // The Mac account's full name gives a real first name; the short account
  // name is often a handle ("jsmith"), as is the Gmail local-part,
  // and the extractor then misses mail that says "Hi Suraj".
  const full = accountFirstName()
  if (full) return full
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
  const { pauseAiUntil: pausedUntil, screenReading } = loadConfig()
  if (!screenReading) {
    const notice = new Notification({
      title: 'Screen reading is off',
      body: 'Turn it on in Settings → Capture to make tasks from what’s on screen.'
    })
    notice.on('click', () => showSettingsWindow('capture'))
    notice.show()
    return
  }
  if (isAiPaused(pausedUntil) && pausedUntil) {
    new Notification({ title: 'AmbientMind', body: describePause(pausedUntil) }).show()
    return
  }
  broadcast(IPC.ScreenStatus, { state: 'running' })

  try {
    const config = loadConfig()
    const result = await screenToTask(instruction, {
      userName: currentUserName(),
      excludedApps: config.excludedApps,
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
      source: 'screen',
      people: result.people,
      // The summary is the whole point: it lets the task be acted on later
      // without going back to whatever was on screen at the time.
      rawContext: result.summary,
      confidence: 1
    })
    broadcastTasks()

    new Notification({ title: result.title, body: result.summary || 'Added from screen' }).show()
  } catch (err) {
    if (err instanceof ScreenRefused) {
      new Notification({ title: 'AmbientMind', body: err.message }).show()
      return
    }
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

  // Only news: a pass that found nothing says so in the panel, not on screen,
  // and the same error isn't repeated every interval.
  const error = report.errors[0] ?? null
  const news =
    report.added > 0
      ? `Added ${report.added} task${report.added === 1 ? '' : 's'}${report.errors.length ? ` · ${report.errors.length} problem${report.errors.length === 1 ? '' : 's'}` : ''}`
      : error && error !== lastNotifiedError
        ? error
        : null
  lastNotifiedError = error
  if (news && !isAiPaused(loadConfig().pauseAiUntil) && !quiet) {
    new Notification({ title: 'AmbientMind', body: news }).show()
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
let shortcutHandlers: Record<ShortcutAction, () => void> | null = null
let registeredShortcuts: string[] = []

function unregisterShortcuts() {
  for (const accelerator of registeredShortcuts) globalShortcut.unregister(accelerator)
  registeredShortcuts = []
  holdGesture?.reset()
  if (helperReady()) void helperRequest('hotkey.clear', { name: 'quickAdd' }).catch(() => {})
}

let holdGesture: HoldGesture | null = null

/**
 * On the Mac the helper owns the Quick Capture shortcut, because it sees the
 * key go up as well as down: hold it to talk. Electron keeps it whenever the
 * helper is missing or restarting, as a plain toggle.
 */
function initHoldToTalk() {
  if (os !== 'mac') return
  const send = (channel: string, ...args: unknown[]) => getQuickAddWindow()?.webContents.send(channel, ...args)
  holdGesture = new HoldGesture({
    isOpen: () => getQuickAddWindow()?.isVisible() ?? false,
    open: () => showQuickAdd(),
    toggleMic: () => send(IPC.QuickAddShortcutAgain),
    holdStart: () => send(IPC.QuickAddHold, 'start'),
    holdEnd: () => send(IPC.QuickAddHold, 'end')
  })
  onHelperEvent('hotkey', ({ name, phase }) => {
    if (name !== 'quickAdd') return
    if (phase === 'down') holdGesture?.down()
    else holdGesture?.up()
  })
  // Ready: move the shortcut to the helper. Gone: take it back.
  onHelperState((state) => {
    if (state === 'ready' || state === 'starting' || state === 'unavailable') registerShortcuts()
  })
}

/** Moves Quick Capture's shortcut to the helper; falls back to Electron if it refuses. */
async function registerHoldToTalk(accelerator: string) {
  const hotkey = macHotkey(accelerator)
  try {
    if (!hotkey) throw new Error(`${accelerator} has no Mac key code`)
    await helperRequest('hotkey.set', { name: 'quickAdd', ...hotkey })
    console.log('[shortcuts] quick add is hold-to-talk through the helper')
    return
  } catch (err) {
    console.warn('[shortcuts] helper hotkey refused:', (err as Error).message)
  }
  const status = shortcutStatus.find((s) => s.action === 'quickAdd')
  if (!status || status.accelerator !== accelerator || !shortcutHandlers || registeredShortcuts.includes(accelerator)) return
  let registered = false
  try {
    registered = globalShortcut.register(accelerator, guard('shortcut:quickAdd', shortcutHandlers.quickAdd))
  } catch (err) {
    console.warn('[shortcuts] failed to register', accelerator, err)
  }
  if (registered) registeredShortcuts.push(accelerator)
  else status.problem ??= 'Another app is using these keys'
}

/**
 * A known conflict is reported but still registered: the user may have
 * turned the other owner off. Registration fails when another app already
 * holds the keys, and that is reported too, instead of a dead shortcut.
 * Called again whenever the user changes a shortcut.
 */
function registerShortcuts(handlers?: Record<ShortcutAction, () => void>) {
  if (handlers) shortcutHandlers = handlers
  if (!shortcutHandlers) return
  unregisterShortcuts()
  const set = resolveShortcuts(os, loadConfig().shortcuts)
  const conflicts = findConflicts(set, os)
  const holdToTalk = holdGesture !== null && helperReady()
  shortcutStatus = (Object.keys(set) as ShortcutAction[]).map((action) => {
    const accelerator = set[action]
    let registered = false
    if (action === 'quickAdd' && holdToTalk) {
      // Reported as registered; registerHoldToTalk corrects it if the helper refuses.
      registered = true
    } else {
      try {
        registered = globalShortcut.register(accelerator, guard(`shortcut:${action}`, shortcutHandlers![action]))
      } catch (err) {
        console.warn('[shortcuts] failed to register', accelerator, err)
      }
      if (registered) registeredShortcuts.push(accelerator)
    }
    return {
      action,
      name: SHORTCUT_NAMES[action],
      accelerator,
      label: shortcutLabel(accelerator, os),
      problem: conflicts[action] ?? (registered ? null : 'Another app is using these keys')
    }
  })
  if (holdToTalk) void registerHoldToTalk(set.quickAdd)
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
} else if (process.argv.includes('--helper-check')) {
  // Writes its report to the data folder too: launched with `open`, stdout goes nowhere.
  void app.whenReady().then(async () => {
    const result = await runHelperCheck()
    const report = JSON.stringify(result, null, 2)
    console.log(report)
    writeFileSync(join(app.getPath('userData'), 'helper-check.json'), report)
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
  setAppIdentity()
  // A menu-bar app: Settings and Chat bring the Dock icon back while open.
  hideDock()

  void app.whenReady().then(() => {
    installNetworkLog(join(app.getPath('userData'), 'network.jsonl'), [session.defaultSession])
    // Set before any page loads, so a protected window is never captured even once.
    app.on('browser-window-created', (_event, win) => win.setContentProtection(loadConfig().contentProtection))
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

    // Optional: every caller falls back when it is missing or still starting.
    startHelper()
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
    configureAi({
      apple: os === 'mac' ? helperAppleModel : null,
      preference: config.aiEngine,
      ollamaModel: config.ollamaModel,
      onCall: openAiLog(join(app.getPath('userData'), 'ai-calls.jsonl'))
    })
    // A store holding two embedding conventions ranks neighbours across two
    // slightly different spaces, so this is a repair and should start now
    // rather than at the first sweep. It no-ops once every row agrees.
    void backfillEmbeddings(config.embeddingModel)
    createOverlayWindow(config)
    createQuickAddWindow()
    // A menu bar icon would appear on the screen of whoever is working while QA runs.
    if (!qaEnabled) trayHandle = createTray({
      onSyncNow: () => triggerSync(true),
      onOpenSettings: () => showSettingsWindow(),
      launchAtLogin: () => loadConfig().launchAtLogin,
      setLaunchAtLogin: (on) => {
        const previous = loadConfig()
        applyLiveConfig(saveConfig({ launchAtLogin: on }), previous)
      },
      pauseAiUntil: () => loadConfig().pauseAiUntil,
      setPauseAiUntil: (until) => {
        const previous = loadConfig()
        applyLiveConfig(saveConfig({ pauseAiUntil: until }), previous)
      },
      quietLabel: () => quiet?.label ?? null
    })
    syncQuietWatch(config.quietMode)

    nativeTheme.themeSource = config.theme
    registerShortcuts({
      quickAdd: toggleQuickAdd,
      capture: () => void captureScreenAsTask(),
      settings: () => showSettingsWindow(),
      chat: () => showChatWindow()
    })
    // What the tray and the shortcuts would do, for QA runs that have neither.
    if (qaControl) {
      const qaWindow = (kind: string) => {
        const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && w.webContents.getURL().includes(`/${kind}/`))
        if (!win) throw new Error(`No ${kind} window`)
        return win
      }
      qaControl.actions = {
        syncNow: () => triggerSync(true),
        settings: (section?: string) => showSettingsWindow(section),
        chat: () => showChatWindow(),
        quickAdd: () => showQuickAdd(),
        onboarding: () => showOnboardingWindow(),
        expand: (on = true) => setOverlayExpanded(on),
        capture: () => captureScreenAsTask(),
        dueAlerts: () => sendDueAlerts(),
        // Live runs check Reminders, Calendar and the QA Google calendar from
        // outside the UI. The helper's QA guard and the QA network policy
        // limit both to things named "AmbientMind QA".
        helper: (method: string, params: unknown = {}) => helperRequest(method as HelperMethod, params as never, { timeoutMs: 30_000 }),
        googleCalendar: async (path: string, method = 'GET') => {
          const response = await googleFetch(`https://www.googleapis.com/calendar/v3${path}`, { method })
          return { status: response.status, body: response.status === 204 ? null : await response.json().catch(() => null) }
        },
        googleGet: async (url: string) => {
          if (!/^https:\/\/(gmail|www)\.googleapis\.com\//.test(url)) throw new Error('Google APIs only')
          const response = await googleFetch(url)
          return { status: response.status, body: await response.json().catch(() => null) }
        },
        // Calls a window's preload API, as its page would.
        renderer: (kind: string, script: string) => qaWindow(kind).webContents.executeJavaScript(script, true),
        screenshot: async (kind: string, file: string) => {
          if (!qaFolderAllowed(dirname(file))) throw new Error(`${file} is not inside a QA run folder`)
          mkdirSync(dirname(file), { recursive: true })
          writeFileSync(file, (await qaWindow(kind).webContents.capturePage()).toPNG())
          return file
        },
        quit: () => setTimeout(() => app.quit(), 100)
      }
    }
    startScheduler(config.syncIntervalMinutes, () => syncOptions(), onScheduledSync)
    if (!config.onboarded) showOnboardingWindow()

    setSpeechModel(config.whisperModel)
    initLiveSpeech()
    initHoldToTalk()
    initAppleSources({
      onTasksChanged: () => {
        broadcastTasks()
        trayHandle?.refresh()
      }
    })

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
        sendDueAlerts()
        // A timed pause ends on its own; the menu bar should say so.
        const paused = isAiPaused(loadConfig().pauseAiUntil)
        if (paused !== wasPaused) {
          wasPaused = paused
          trayHandle?.refresh()
          broadcast(IPC.ConfigChanged, loadConfig())
        }
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
    void stopHelper()
    disposeSpeech()
    closeTaskStore()
  })
}
