import { app, ipcMain, session } from 'electron'
import { IPC } from '@shared/ipc'
import type { Task } from '@shared/types'
import { createOverlayWindow, getOverlayWindow, setMouseCapture } from './overlay'
import { createTray } from './tray'
import { seedTasks } from './seedTasks'

// Phase 1 keeps state in memory; Phase 2 swaps this for the SQLite task store.
let tasks: Task[] = seedTasks

function broadcastTasks() {
  getOverlayWindow()?.webContents.send(IPC.TasksChanged, tasks)
}

function registerIpc() {
  ipcMain.on(IPC.SetMouseCapture, (_event, capture: boolean) => setMouseCapture(capture))

  ipcMain.handle(IPC.GetTasks, () => tasks)

  ipcMain.handle(IPC.CompleteTask, (_event, id: string) => {
    tasks = tasks.map((task) =>
      task.id === id
        ? { ...task, status: 'done' as const, completedAt: new Date().toISOString() }
        : task
    )
    broadcastTasks()
    return tasks
  })
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  // The overlay is the whole UI, so there is no dock presence to keep alive.
  app.dock?.hide()

  void app.whenReady().then(() => {
    // Applied as a header rather than a meta tag so the dev server's HMR
    // websocket and inline styles are not blocked during development.
    if (app.isPackaged) {
      session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
        callback({
          responseHeaders: {
            ...details.responseHeaders,
            'Content-Security-Policy': ["default-src 'self'; style-src 'self' 'unsafe-inline'"]
          }
        })
      })
    }

    registerIpc()
    createOverlayWindow()
    createTray()
  })

  // Tray-resident app: closing the overlay must not terminate the process.
  app.on('window-all-closed', () => {})
}
