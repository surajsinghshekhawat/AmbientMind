import { join } from 'node:path'
import { BrowserWindow, screen } from 'electron'
import { IPC } from '@shared/ipc'

const WIDTH = 560
const HEIGHT = 76
/** Sits high on screen so it never collides with the overlay's corner. */
const VERTICAL_FRACTION = 0.22

let quickAddWindow: BrowserWindow | null = null
/** True while the mic is open — blur must not dismiss the palette mid-utterance. */
let recording = false

export function createQuickAddWindow(): BrowserWindow {
  quickAddWindow = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
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
      sandbox: false
    }
  })

  quickAddWindow.setAlwaysOnTop(true, 'screen-saver')

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
    height: HEIGHT
  })
}

export function toggleQuickAdd() {
  const win = quickAddWindow
  if (!win) return

  if (win.isVisible()) {
    hideQuickAdd()
    return
  }

  centerOnActiveDisplay(win)
  win.show()
  win.focus()
  win.webContents.send(IPC.QuickAddOpened)
}

export function hideQuickAdd() {
  if (quickAddWindow?.isVisible()) quickAddWindow.hide()
}

export function getQuickAddWindow() {
  return quickAddWindow
}
