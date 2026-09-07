import { app, globalShortcut, ipcMain, session } from 'electron'
import { IPC, QUICK_ADD_SHORTCUT } from '@shared/ipc'
import { createOverlayWindow, getOverlayWindow, setMouseCapture } from './overlay'
import { createQuickAddWindow, hideQuickAdd, toggleQuickAdd } from './quickAdd'
import { createTray } from './tray'
import {
  addTask,
  archiveStaleCompleted,
  closeTaskStore,
  deleteTask,
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
import { DEFAULT_CONFIG } from '@shared/types'
import { seedIfEmpty } from './seedTasks'

const ARCHIVE_SWEEP_MS = 15 * 60_000

function broadcastTasks() {
  getOverlayWindow()?.webContents.send(IPC.TasksChanged, listActive())
}

function registerIpc() {
  ipcMain.on(IPC.SetMouseCapture, (_event, capture: boolean) => setMouseCapture(capture))

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
    if (!trimmed) return

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

  ipcMain.on(IPC.QuickAddCancel, () => hideQuickAdd())

  ipcMain.handle(IPC.GetAccountStatus, () => ({
    google: isGoogleConnected(),
    googleEmail: connectedGoogleAccount(),
    credentialsConfigured: loadCredentials() !== null
  }))

  ipcMain.handle(IPC.ConnectGoogle, async () => {
    const result = await connectGoogle()
    await triggerSync()
    return result
  })

  ipcMain.handle(IPC.DisconnectGoogle, async () => {
    await disconnectGoogle()
    return { google: false }
  })

  ipcMain.handle(IPC.RunSyncNow, () => triggerSync())
}

async function triggerSync(): Promise<SyncReport> {
  getOverlayWindow()?.webContents.send(IPC.SyncStatus, { state: 'running' })
  const report = await runSync({ model: DEFAULT_CONFIG.ollamaModel })
  if (report.added > 0) broadcastTasks()
  getOverlayWindow()?.webContents.send(IPC.SyncStatus, { state: 'idle', report })
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

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  // The overlay is the whole UI, so there is no dock presence to keep alive.
  app.dock?.hide()

  void app.whenReady().then(() => {
    applyProductionCsp()
    openTaskStore()
    if (!app.isPackaged) seedIfEmpty()
    archiveStaleCompleted()
    registerIpc()

    createOverlayWindow()
    createQuickAddWindow()
    createTray({ onSyncNow: triggerSync })

    globalShortcut.register(QUICK_ADD_SHORTCUT, toggleQuickAdd)
    startScheduler(DEFAULT_CONFIG.syncIntervalMinutes, { model: DEFAULT_CONFIG.ollamaModel })

    setInterval(() => {
      if (archiveStaleCompleted() > 0) broadcastTasks()
    }, ARCHIVE_SWEEP_MS)
  })

  // Tray-resident app: closing a window must not terminate the process.
  app.on('window-all-closed', () => {})

  app.on('will-quit', () => {
    globalShortcut.unregisterAll()
    stopScheduler()
    closeTaskStore()
  })
}
