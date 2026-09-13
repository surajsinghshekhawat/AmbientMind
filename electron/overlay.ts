import { join } from 'node:path'
import { BrowserWindow, screen, type Rectangle } from 'electron'
import { IPC } from '@shared/ipc'
import { DEFAULT_CONFIG, type Config, type OverlayCorner } from '@shared/types'

const MARGIN = 24
/** Matches the 64px disc + 3px ring; extra pixels are what Windows paints as a square. */
const ORB_SIZE = 70
const COLLAPSED_SIZE = ORB_SIZE

let overlayWindow: BrowserWindow | null = null
/** Starts as a corner circle; click expands the task list. */
let expanded = false
let currentConfig: Config = DEFAULT_CONFIG

function boundsFor(corner: OverlayCorner, width: number, isExpanded: boolean) {
  const { x, y, width: aw, height: ah } = screen.getPrimaryDisplay().workArea
  const w = isExpanded ? width : COLLAPSED_SIZE
  const h = isExpanded ? ah - MARGIN * 2 : COLLAPSED_SIZE

  return {
    x: corner.endsWith('right') ? x + aw - w - MARGIN : x + MARGIN,
    y: corner.startsWith('bottom') && !isExpanded ? y + ah - h - MARGIN : y + MARGIN,
    width: w,
    height: h
  }
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
  if (!overlayWindow) return
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
    ...boundsFor(config.overlayCorner, config.overlayWidth, expanded),
    transparent: true,
    frame: false,
    hasShadow: false,
    thickFrame: false,
    roundedCorners: false,
    backgroundMaterial: 'none',
    backgroundColor: '#00000000',
    titleBarStyle: 'hidden',
    // Tool window: no Win11 caption/snap buttons on the orb.
    type: 'toolbar',
    focusable: false,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    closable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    webPreferences: {
      preload: join(__dirname, '../preload/preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false
    }
  })

  overlayWindow.setAlwaysOnTop(true, 'screen-saver')
  overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false })
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

  overlayWindow.on('closed', () => {
    overlayWindow = null
  })
  overlayWindow.webContents.on('did-finish-load', () => applyWindowShape())

  screen.on('display-metrics-changed', () => reposition())
  screen.on('display-added', () => reposition())
  screen.on('display-removed', () => reposition())

  return overlayWindow
}

function reposition() {
  overlayWindow?.setBounds(
    boundsFor(currentConfig.overlayCorner, currentConfig.overlayWidth, expanded)
  )
  applyWindowShape()
}

export function applyOverlayConfig(config: Config) {
  currentConfig = config
  reposition()
}

export function setOverlayExpanded(next: boolean) {
  if (next !== expanded) {
    expanded = next
    reposition()
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
