import { join } from 'node:path'
import { BrowserWindow } from 'electron'
import { bringToFront, prepareUtilityWindow, utilityWindowOptions } from './platform'

let settingsWindow: BrowserWindow | null = null

export function showSettingsWindow() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    bringToFront(settingsWindow)
    return settingsWindow
  }

  settingsWindow = new BrowserWindow({
    width: 460,
    height: 680,
    minWidth: 400,
    minHeight: 520,
    title: 'AmbientMind settings',
    ...utilityWindowOptions,
    webPreferences: {
      preload: join(__dirname, '../preload/preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  })

  prepareUtilityWindow(settingsWindow, 'settings')

  if (process.env.ELECTRON_RENDERER_URL) {
    void settingsWindow.loadURL(`${process.env.ELECTRON_RENDERER_URL}/settings/index.html`)
  } else {
    void settingsWindow.loadFile(join(__dirname, '../renderer/settings/index.html'))
  }

  settingsWindow.on('closed', () => {
    settingsWindow = null
  })

  bringToFront(settingsWindow)
  return settingsWindow
}

export function getSettingsWindow() {
  return settingsWindow
}
