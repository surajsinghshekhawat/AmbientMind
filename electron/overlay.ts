import { join } from 'node:path'
import { app, BrowserWindow, screen, type Display, type Rectangle } from 'electron'
import { IPC } from '@shared/ipc'
import { overlayBounds } from '@shared/overlayGeometry'
import { DEFAULT_CONFIG, type Config } from '@shared/types'
import { overlayWindowOptions, prepareOverlay, shapesOverlay } from './platform'

let overlayWindow: BrowserWindow | null = null
/** Starts as a corner circle; click expands the task list. */
let expanded = false
let currentConfig: Config = DEFAULT_CONFIG
/** The display the overlay lives on; it moves to the cursor's display when opened. */
let displayId: number | null = null
let quitting = false

function cursorDisplay(): Display {
  return screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
}

function currentDisplay(followCursor: boolean): Display {
  const kept = followCursor ? undefined : screen.getAllDisplays().find((d) => d.id === displayId)
  const display = kept ?? cursorDisplay()
  displayId = display.id
  return display
}

function boundsFor(followCursor = false) {
  return overlayBounds({
    workArea: currentDisplay(followCursor).workArea,
    corner: currentConfig.overlayCorner,
    width: currentConfig.overlayWidth,
    expanded
  })
}

/** Scanline circle so DWM cannot fill the square corners of the HWND. */
function circleShape(size: number): Rectangle[] {
  const r = size / 2
  const rects: Rectangle[] = []
  for (let y = 0; y < size; y++) {
    const dy = y + 0.5 - r
    const half = Math.sqrt(Math.max(0, r * r - dy * dy))
    const x = Math.round(r - half)
    const width = Math.max(1, Math.round(2 * half))
    rects.push({ x, y, width, height: 1 })
  }
  return rects
}

function applyWindowShape() {
  if (!overlayWindow || !shapesOverlay) return
  if (expanded) {
    overlayWindow.setShape([])
    return
  }
  const { width, height } = overlayWindow.getBounds()
  overlayWindow.setShape(circleShape(Math.min(width, height)))
}

export function createOverlayWindow(config: Config = DEFAULT_CONFIG): BrowserWindow {
  currentConfig = config
  overlayWindow = new BrowserWindow({
    ...boundsFor(true),
    ...overlayWindowOptions,
    transparent: true,
    frame: false,
    hasShadow: false,
    backgroundColor: '#00000000',
    titleBarStyle: 'hidden',
    focusable: false,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    webPreferences: {
      preload: join(__dirname, '../preload/preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  })

  prepareOverlay(overlayWindow)
  overlayWindow.setBackgroundColor('#00000000')
  overlayWindow.setHasShadow(false)
  overlayWindow.removeMenu()
  overlayWindow.setMenuBarVisibility(false)
  applyMouseIgnore()
  applyWindowShape()

  if (process.env.ELECTRON_RENDERER_URL) {
    void overlayWindow.loadURL(`${process.env.ELECTRON_RENDERER_URL}/overlay/index.html`)
  } else {
    void overlayWindow.loadFile(join(__dirname, '../renderer/overlay/index.html'))
  }

  // The overlay is the app: nothing but quitting may close it. It has to stay
  // closable, though, because macOS cancels a quit when a window refuses.
  overlayWindow.on('close', (event) => {
    if (!quitting) event.preventDefault()
  })
  overlayWindow.on('closed', () => {
    overlayWindow = null
  })
  overlayWindow.webContents.on('did-finish-load', () => applyWindowShape())

  screen.on('display-metrics-changed', () => reposition())
  screen.on('display-added', () => reposition())
  screen.on('display-removed', () => reposition())

  return overlayWindow
}

app.on('before-quit', () => {
  quitting = true
})

function reposition(followCursor = false) {
  overlayWindow?.setBounds(boundsFor(followCursor))
  applyWindowShape()
}

export function applyOverlayConfig(config: Config) {
  currentConfig = config
  reposition()
}

export function setOverlayExpanded(next: boolean) {
  if (next !== expanded) {
    expanded = next
    // Opened from the tray or a shortcut, the list belongs where you are looking.
    reposition(next)
  }
  applyMouseIgnore(true)
  overlayWindow?.webContents.send(IPC.OverlayExpandedChanged, expanded)
}

export function isOverlayExpanded() {
  return expanded
}

let wantCapture = false

function applyMouseIgnore(forceCapture = false) {
  if (!overlayWindow) return
  if (!expanded) {
    overlayWindow.setIgnoreMouseEvents(false)
    return
  }
  if (forceCapture) wantCapture = true
  overlayWindow.setIgnoreMouseEvents(!wantCapture, { forward: true })
}

export function setMouseCapture(capture: boolean) {
  wantCapture = capture
  applyMouseIgnore()
}

export function getOverlayWindow() {
  return overlayWindow
}
