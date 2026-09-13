import { app, dialog, Menu, Tray, nativeImage } from 'electron'
import { getOverlayWindow, setOverlayExpanded } from './overlay'
import {
  connectGoogle,
  connectedGoogleAccount,
  disconnectGoogle,
  isGoogleConnected,
  loadCredentials
} from './services/googleAuth'

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

export interface TrayActions {
  onSyncNow: () => Promise<unknown>
  onOpenSettings: () => void
}

export function createTray(actions: TrayActions) {
  tray = new Tray(placeholderIcon())
  tray.setToolTip('AmbientMind')

  const rebuild = () => {
    const overlay = getOverlayWindow()
    const connected = isGoogleConnected()
    const email = connectedGoogleAccount()

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
        {
          label: 'Expand overlay',
          click: () => {
            setOverlayExpanded(true)
            rebuild()
          }
        },
        {
          label: 'Minimize to corner',
          click: () => {
            setOverlayExpanded(false)
            rebuild()
          }
        },
        { type: 'separator' },
        {
          label: connected ? `Google: ${email ?? 'connected'}` : 'Google: not connected',
          enabled: false
        },
        {
          label: connected ? 'Disconnect Google' : 'Connect Google account…',
          click: async () => {
            try {
              if (connected) {
                await disconnectGoogle()
              } else if (!loadCredentials()) {
                dialog.showMessageBox({
                  type: 'info',
                  title: 'Google setup required',
                  message: 'No OAuth client configured',
                  detail:
                    'Create a Desktop OAuth client in Google Cloud Console and save it as ' +
                    'google-credentials.json in the app data folder. See docs/google-setup.md.'
                })
              } else {
                await connectGoogle()
              }
            } catch (err) {
              dialog.showErrorBox('Google connection failed', (err as Error).message)
            }
            rebuild()
          }
        },
        {
          label: 'Sync now',
          enabled: connected,
          click: () => void actions.onSyncNow()
        },
        { type: 'separator' },
        { label: 'Settings…', click: () => actions.onOpenSettings() },
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
  return { tray, refresh: rebuild }
}
