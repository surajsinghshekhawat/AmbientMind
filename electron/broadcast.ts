import { BrowserWindow } from 'electron'

/**
 * Sends to every open window. Task, config and status changes used to reach
 * only the overlay, so Settings and Chat showed stale data until reopened.
 */
export function broadcast(channel: string, payload?: unknown) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed() || win.webContents.isDestroyed()) continue
    win.webContents.send(channel, payload)
  }
}
