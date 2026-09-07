import { join } from 'node:path'
import { BrowserWindow, screen } from 'electron'
import { DEFAULT_CONFIG, type Config, type OverlayCorner } from '@shared/types'

const MARGIN = 24
/** Footprint of the collapsed orb, including room for its hover ring. */
const COLLAPSED_SIZE = 72

let overlayWindow: BrowserWindow | null = null
let expanded = false

/**
 * The window is resized on collapse rather than just hiding content. A
 * full-height transparent window would keep swallowing hit-tests across the
 * whole edge of the screen even when nothing is drawn there.
 */
function boundsFor(corner: OverlayCorner, width: number, isExpanded: boolean) {
  const { x, y, width: aw, height: ah } = screen.getPrimaryDisplay().workArea
  const w = isExpanded ? width : COLLAPSED_SIZE
  const h = isExpanded ? ah - MARGIN * 2 : COLLAPSED_SIZE

  return {
    x: corner.endsWith('right') ? x + aw - w - MARGIN : x + MARGIN,
    // Collapsed, the orb hugs whichever corner is configured; expanded, the
    // panel always grows downward from the top so the list reads top-first.
    y: corner.startsWith('bottom') && !isExpanded ? y + ah - h - MARGIN : y + MARGIN,
    width: w,
    height: h
  }
}

export function createOverlayWindow(config: Config = DEFAULT_CONFIG): BrowserWindow {
  overlayWindow = new BrowserWindow({
    ...boundsFor(config.overlayCorner, config.overlayWidth, expanded),
    transparent: true,
    frame: false,
    hasShadow: false,
    // Keeps the panel from stealing focus from whatever the user is typing in.
    // On Windows this maps to WS_EX_NOACTIVATE, which still delivers clicks.
    focusable: false,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    // 'screen-saver' is the only level that stays above maximised windows and
    // the taskbar, which is what "ambient and always visible" actually requires.
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
  setMouseCapture(false)

  if (process.env.ELECTRON_RENDERER_URL) {
    void overlayWindow.loadURL(`${process.env.ELECTRON_RENDERER_URL}/overlay/index.html`)
  } else {
    void overlayWindow.loadFile(join(__dirname, '../renderer/overlay/index.html'))
  }

  overlayWindow.on('closed', () => {
    overlayWindow = null
  })

  screen.on('display-metrics-changed', () => reposition(config))
  screen.on('display-added', () => reposition(config))
  screen.on('display-removed', () => reposition(config))

  return overlayWindow
}

function reposition(config: Config) {
  overlayWindow?.setBounds(boundsFor(config.overlayCorner, config.overlayWidth, expanded))
}

export function setOverlayExpanded(next: boolean, config: Config = DEFAULT_CONFIG) {
  if (next === expanded) return
  expanded = next
  overlayWindow?.setBounds(boundsFor(config.overlayCorner, config.overlayWidth, expanded))
}

export function isOverlayExpanded() {
  return expanded
}

/**
 * `forward: true` keeps mousemove flowing to the renderer while the window is
 * transparent to clicks, which is what lets the renderer notice a hover and ask
 * for capture back.
 */
export function setMouseCapture(capture: boolean) {
  overlayWindow?.setIgnoreMouseEvents(!capture, { forward: true })
}

export function getOverlayWindow() {
  return overlayWindow
}
