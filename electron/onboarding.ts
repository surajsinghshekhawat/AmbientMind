import { join } from 'node:path'
import { BrowserWindow, nativeTheme } from 'electron'
import { bringToFront, insetTitleBarOptions, prepareUtilityWindow, utilityWindowOptions } from './platform'

let onboardingWindow: BrowserWindow | null = null

export function showOnboardingWindow() {
  if (onboardingWindow && !onboardingWindow.isDestroyed()) {
    bringToFront(onboardingWindow)
    return onboardingWindow
  }

  onboardingWindow = new BrowserWindow({
    width: 640,
    height: 560,
    resizable: false,
    minimizable: false,
    fullscreenable: false,
    center: true,
    title: 'Welcome to AmbientMind',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1c1c1f' : '#fbfbfc',
    ...insetTitleBarOptions,
    ...utilityWindowOptions,
    webPreferences: {
      preload: join(__dirname, '../preload/preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  })

  prepareUtilityWindow(onboardingWindow, 'onboarding')

  if (process.env.ELECTRON_RENDERER_URL) {
    void onboardingWindow.loadURL(`${process.env.ELECTRON_RENDERER_URL}/onboarding/index.html`)
  } else {
    void onboardingWindow.loadFile(join(__dirname, '../renderer/onboarding/index.html'))
  }

  onboardingWindow.on('closed', () => {
    onboardingWindow = null
  })

  bringToFront(onboardingWindow)
  return onboardingWindow
}

export function getOnboardingWindow() {
  return onboardingWindow
}
