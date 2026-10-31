import { app, dialog, Menu, Tray, nativeImage } from 'electron'
import { TRAY_ICON_16, TRAY_ICON_32 } from './assets/trayIcon'
import { showChatWindow } from './chat'
import { getOverlayWindow, isOverlayExpanded, setOverlayExpanded } from './overlay'
import { trayMenuOnRightClick } from './platform'
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
  // macOS draws a template image from its alpha alone, in the menu bar's own
  // colour for light, dark and tinted menu bars. Windows ignores the flag.
  image.setTemplateImage(true)
  return image
}

export interface TrayActions {
  onSyncNow: () => Promise<unknown>
  onOpenSettings: () => void
  /** Goes through the saved config, which is what applies the login item. */
  launchAtLogin: () => boolean
  setLaunchAtLogin: (on: boolean) => void
}

export function createTray(actions: TrayActions) {
  tray = new Tray(trayIcon())
  tray.setToolTip('AmbientMind')
  let menu: Menu | null = null
  // Left-click is the obvious gesture for "show me the list".
  tray.on('click', () => setOverlayExpanded(!isOverlayExpanded()))
  // An attached context menu would swallow left-clicks on the Mac.
  if (trayMenuOnRightClick) tray.on('right-click', () => menu && tray?.popUpContextMenu(menu))

  const rebuild = () => {
    const overlay = getOverlayWindow()
    const connected = isGoogleConnected()
    const email = connectedGoogleAccount()

    const pending = listActive().filter((task) => task.status === 'pending').length
    tray?.setToolTip(`AmbientMind — ${pending} pending`)

    menu = Menu.buildFromTemplate([
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
      { label: 'Ask about my tasks…', click: () => showChatWindow() },
      { label: 'Settings…', click: () => actions.onOpenSettings() },
      { type: 'separator' },
      {
        label: 'Start at login',
        type: 'checkbox',
        checked: actions.launchAtLogin(),
        click: (item) => actions.setLaunchAtLogin(item.checked)
      },
      { type: 'separator' },
      { label: 'Quit AmbientMind', click: () => app.quit() }
    ])
    if (!trayMenuOnRightClick) tray?.setContextMenu(menu)
  }

  rebuild()
  return { tray, refresh: rebuild }
}
