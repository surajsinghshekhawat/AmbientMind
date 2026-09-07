import { join } from 'node:path'
import { BrowserWindow, screen } from 'electron'
import { DEFAULT_CONFIG, type Config, type OverlayCorner } from '@shared/types'

const MARGIN = 24

let overlayWindow: BrowserWindow | null = null

function boundsFor(corner: OverlayCorner, width: number) {
  const display = screen.getPrimaryDisplay()
  const { x, y, width: aw, height: ah } = display.workArea
  const height = ah - MARGIN * 2

  return {
    x: corner.endsWith('right') ? x + aw - width - MARGIN : x + MARGIN,
    y: y + MARGIN,
    width,
    height
  }
}

export function createOverlayWindow(config: Config = DEFAULT_CONFIG): BrowserWindow {
  overlayWindow = new BrowserWindow({
    ...boundsFor(config.overlayCorner, config.overlayWidth),
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
  overlayWindow?.setBounds(boundsFor(config.overlayCorner, config.overlayWidth))
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
