import { join } from 'node:path'
import { BrowserWindow, screen } from 'electron'
import { IPC } from '@shared/ipc'
import { bringToFront, prepareQuickAdd } from './platform'

const WIDTH = 600
/** Until the renderer reports its real height. */
const START_HEIGHT = 64
const MAX_HEIGHT = 240
/** Sits high on screen so it never collides with the overlay's corner. */
const VERTICAL_FRACTION = 0.22

let quickAddWindow: BrowserWindow | null = null
/** True while the mic is open — blur must not dismiss the palette mid-utterance. */
let recording = false
let height = START_HEIGHT

export function createQuickAddWindow(): BrowserWindow {
  quickAddWindow = new BrowserWindow({
    width: WIDTH,
    height: START_HEIGHT,
    show: false,
    transparent: true,
    frame: false,
    hasShadow: false,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    // Unlike the overlay, this window must take focus: it is a text input.
    focusable: true,
    webPreferences: {
      preload: join(__dirname, '../preload/preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  })

  prepareQuickAdd(quickAddWindow)

  if (process.env.ELECTRON_RENDERER_URL) {
    void quickAddWindow.loadURL(`${process.env.ELECTRON_RENDERER_URL}/quickadd/index.html`)
  } else {
    void quickAddWindow.loadFile(join(__dirname, '../renderer/quickadd/index.html'))
  }

  // Dismiss on focus loss so the palette never lingers behind another window,
  // except while recording — grabbing the mic often steals focus briefly.
  quickAddWindow.on('blur', () => {
    if (!recording) hideQuickAdd()
  })
  quickAddWindow.on('closed', () => {
    quickAddWindow = null
    recording = false
  })

  return quickAddWindow
}

export function setQuickAddRecording(next: boolean) {
  recording = next
}

function centerOnActiveDisplay(win: BrowserWindow) {
  const cursor = screen.getCursorScreenPoint()
  const { x, y, width, height } = screen.getDisplayNearestPoint(cursor).workArea
  win.setBounds({
    x: Math.round(x + (width - WIDTH) / 2),
    y: Math.round(y + height * VERTICAL_FRACTION),
    width: WIDTH,
    height
  })
}

/** The window is exactly as tall as the composer, which grows with its chips. */
export function setQuickAddHeight(next: number) {
  if (!Number.isFinite(next) || next <= 0) return
  height = Math.min(MAX_HEIGHT, Math.ceil(next))
  const win = quickAddWindow
  if (!win) return
  const bounds = win.getBounds()
  if (bounds.height !== height) win.setBounds({ ...bounds, height })
}

export function toggleQuickAdd() {
  const win = quickAddWindow
  if (!win) return

  // Pressed again while open: the composer toggles the mic. Electron cannot
  // see a key being let go; on the Mac the helper's hotkey adds hold-to-talk.
  if (win.isVisible()) {
    win.webContents.send(IPC.QuickAddShortcutAgain)
    return
  }
  showQuickAdd()
}

export function showQuickAdd() {
  const win = quickAddWindow
  if (!win) return
  centerOnActiveDisplay(win)
  bringToFront(win)
  win.webContents.send(IPC.QuickAddOpened)
}

export function hideQuickAdd() {
  if (quickAddWindow?.isVisible()) quickAddWindow.hide()
}

export function getQuickAddWindow() {
  return quickAddWindow
}
