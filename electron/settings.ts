import { join } from 'node:path'
import { BrowserWindow, nativeTheme } from 'electron'
import { IPC } from '@shared/ipc'
import { bringToFront, prepareUtilityWindow, utilityWindowOptions } from './platform'

let settingsWindow: BrowserWindow | null = null

/** `section` opens that page: on load through the hash, after it by message. */
export function showSettingsWindow(section?: string) {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    if (section) settingsWindow.webContents.send(IPC.SettingsShowSection, section)
    bringToFront(settingsWindow)
    return settingsWindow
  }

  settingsWindow = new BrowserWindow({
    width: 760,
    height: 560,
    minWidth: 660,
    minHeight: 440,
    title: 'AmbientMind settings',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1c1c1f' : '#fbfbfc',
    // System Settings layout: the traffic lights sit in the sidebar.
    ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 18, y: 18 } } : {}),
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
    void settingsWindow.loadURL(`${process.env.ELECTRON_RENDERER_URL}/settings/index.html${section ? `#${section}` : ''}`)
  } else {
    void settingsWindow.loadFile(join(__dirname, '../renderer/settings/index.html'), section ? { hash: section } : {})
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
