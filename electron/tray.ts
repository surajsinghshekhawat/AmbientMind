import { app, dialog, Menu, Tray, nativeImage } from 'electron'
import { TRAY_ICON_16, TRAY_ICON_32 } from './assets/trayIcon'
import { getOverlayWindow, setOverlayExpanded } from './overlay'
import { listActive } from './services/taskStore'
import {
  connectGoogle,
  connectedGoogleAccount,
  disconnectGoogle,
  isGoogleConnected,
  loadCredentials
} from './services/googleAuth'

let tray: Tray | null = null

/**
 * Anti-aliased PNGs from scripts/make-icons.cjs, embedded as base64 so the
 * icon resolves the same way from source, from out/ and from inside an asar.
 * The 32px representation is what a 150%-scaled display actually draws.
 */
function trayIcon() {
  const image = nativeImage.createFromDataURL(`data:image/png;base64,${TRAY_ICON_16}`)
  image.addRepresentation({
    scaleFactor: 2,
    dataURL: `data:image/png;base64,${TRAY_ICON_32}`
  })
  // White glyph on transparency: let Windows/macOS tint it for the current theme.
  image.setTemplateImage(true)
  return image
}

export interface TrayActions {
  onSyncNow: () => Promise<unknown>
  onOpenSettings: () => void
}

export function createTray(actions: TrayActions) {
  tray = new Tray(trayIcon())
  tray.setToolTip('AmbientMind')
  // Left-click is the obvious gesture for "show me the list".
  tray.on('click', () => setOverlayExpanded(true))

  const rebuild = () => {
    const overlay = getOverlayWindow()
    const connected = isGoogleConnected()
    const email = connectedGoogleAccount()

    const pending = listActive().filter((task) => task.status === 'pending').length
    tray?.setToolTip(`AmbientMind — ${pending} pending`)

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
