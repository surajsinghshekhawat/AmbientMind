import { app, Menu, Tray, nativeImage } from 'electron'
import { getOverlayWindow } from './overlay'

let tray: Tray | null = null

/**
 * Drawn in code rather than shipped as a file so Phase 1 has no asset pipeline.
 * A real icon replaces this in Phase 8.
 */
function placeholderIcon() {
  const size = 16
  const buffer = Buffer.alloc(size * size * 4)
  for (let i = 0; i < size * size; i++) {
    const x = i % size
    const y = Math.floor(i / size)
    const d = Math.hypot(x - 7.5, y - 7.5)
    const alpha = d < 6.5 && d > 3.5 ? 255 : 0
    buffer[i * 4 + 0] = 255
    buffer[i * 4 + 1] = 255
    buffer[i * 4 + 2] = 255
    buffer[i * 4 + 3] = alpha
  }
  return nativeImage.createFromBuffer(buffer, { width: size, height: size })
}

export function createTray() {
  tray = new Tray(placeholderIcon())
  tray.setToolTip('AmbientMind')

  const rebuild = () => {
    const overlay = getOverlayWindow()
    tray?.setContextMenu(
      Menu.buildFromTemplate([
        {
          label: overlay?.isVisible() ? 'Hide overlay' : 'Show overlay',
          click: () => {
            if (!overlay) return
            overlay.isVisible() ? overlay.hide() : overlay.showInactive()
            rebuild()
          }
        },
        { type: 'separator' },
        {
          label: 'Start at login',
          type: 'checkbox',
          checked: app.getLoginItemSettings().openAtLogin,
          click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked })
        },
        { type: 'separator' },
        { label: 'Quit AmbientMind', click: () => app.quit() }
      ])
    )
  }

  rebuild()
  return tray
}
