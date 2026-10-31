import {
  app,
  Menu,
  systemPreferences,
  type BrowserWindow,
  type BrowserWindowConstructorOptions,
  type MenuItemConstructorOptions
} from 'electron'
import type { Os } from '@shared/shortcuts'
import {
  permissionHelp,
  privacySettingsUrl,
  type AccessStatus,
  type PermissionKind,
  type PermissionState
} from '@shared/permissions'
import { DockPresence } from './dockPresence'

/**
 * Everything that differs between macOS and Windows. Feature code calls these
 * and never checks `process.platform` itself.
 */
export const os: Os =
  process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'win' : 'linux'
export const isMac = os === 'mac'

/**
 * On the Mac a panel floats above normal windows without activating the app.
 * On Windows a tool window keeps Win11's caption and snap buttons off the orb.
 */
export const overlayWindowOptions: BrowserWindowConstructorOptions = isMac
  ? { type: 'panel' }
  : { type: 'toolbar', thickFrame: false, roundedCorners: false, backgroundMaterial: 'none' }

/**
 * Windows paints the square corners of a transparent HWND, so the collapsed
 * orb is cut to a circle there. macOS composites transparency itself.
 */
export const shapesOverlay = os === 'win'

/**
 * `skipTransformProcessType` matters: without it, showing on every Space
 * turns the app into a regular one and a Dock icon appears. 'floating' keeps
 * the orb above documents but below menus, alerts and the screen saver.
 */
export function prepareOverlay(win: BrowserWindow) {
  if (isMac) {
    win.setAlwaysOnTop(true, 'floating')
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false, skipTransformProcessType: true })
    win.setHiddenInMissionControl(true)
  } else {
    win.setAlwaysOnTop(true, 'screen-saver')
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false })
  }
}

export function prepareQuickAdd(win: BrowserWindow) {
  if (isMac) {
    win.setAlwaysOnTop(true, 'floating')
    // Opens on the Space you are on, including over a full-screen app.
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true })
    win.setHiddenInMissionControl(true)
  } else {
    win.setAlwaysOnTop(true, 'screen-saver')
  }
}

/**
 * Settings and chat. On Windows they sit above the overlay or vanish under
 * it. On the Mac they are normal windows with a Dock icon while open, so ⌘Tab
 * finds them.
 */
export const utilityWindowOptions: BrowserWindowConstructorOptions = isMac
  ? {}
  : { alwaysOnTop: true, autoHideMenuBar: true }

const dock = new DockPresence({
  show: () => void app.dock?.show(),
  hide: () => app.dock?.hide()
})

export function prepareUtilityWindow(win: BrowserWindow, name: string) {
  if (!isMac) {
    win.setAlwaysOnTop(true, 'floating')
    return
  }
  dock.open(name)
  win.on('closed', () => dock.close(name))
}

/** A menu-bar app is never frontmost by itself; a window it opens must be. */
export function bringToFront(win: BrowserWindow) {
  if (isMac) app.focus({ steal: true })
  win.show()
  win.focus()
}

export function hideDock() {
  if (isMac) app.dock?.hide()
}

/**
 * Without Edit roles in the menu, ⌘C, ⌘V, ⌘X, ⌘A and ⌘Z do nothing in text
 * fields on the Mac. Windows handles those keys in the renderer.
 */
export function installAppMenu(actions: { openSettings: () => void }) {
  const dev: MenuItemConstructorOptions[] = app.isPackaged ? [] : [{ role: 'viewMenu' }]
  const template: MenuItemConstructorOptions[] = isMac
    ? [
        {
          label: app.name,
          submenu: [
            { role: 'about' },
            { type: 'separator' },
            { label: 'Settings…', accelerator: 'Command+,', click: () => actions.openSettings() },
            { type: 'separator' },
            { role: 'services' },
            { type: 'separator' },
            { role: 'hide' },
            { role: 'hideOthers' },
            { role: 'unhide' },
            { type: 'separator' },
            { role: 'quit' }
          ]
        },
        { role: 'editMenu' },
        ...dev,
        { role: 'windowMenu' }
      ]
    : [{ role: 'editMenu' }, ...dev]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

/** The tray menu opens on right-click on the Mac; left-click toggles the panel. */
export const trayMenuOnRightClick = isMac

export function accessStatus(kind: PermissionKind): AccessStatus {
  if (kind === 'accessibility') {
    if (!isMac) return 'unknown'
    // macOS keeps no "denied" for Accessibility: off means not allowed yet.
    // The helper is our child, so this answer is its answer too.
    return systemPreferences.isTrustedAccessibilityClient(false) ? 'granted' : 'not-determined'
  }
  // Only macOS gates screen capture; Linux has no system-level answer.
  if (kind === 'screen' && !isMac) return os === 'win' ? 'granted' : 'unknown'
  if (os === 'linux') return 'unknown'
  return systemPreferences.getMediaAccessStatus(kind)
}

/**
 * Shows the system prompt where macOS has one. Accessibility's prompt offers
 * to open System Settings; a refused microphone or Screen Recording never
 * prompts again, so those go to System Settings directly.
 */
export async function requestAccess(kind: PermissionKind): Promise<AccessStatus> {
  if (!isMac) return accessStatus(kind)
  if (kind === 'accessibility') systemPreferences.isTrustedAccessibilityClient(true)
  if (kind === 'microphone' && accessStatus(kind) === 'not-determined') {
    await systemPreferences.askForMediaAccess('microphone')
  }
  return accessStatus(kind)
}

export function permissionState(kind: PermissionKind): PermissionState {
  const status = accessStatus(kind)
  return {
    kind,
    status,
    help: permissionHelp(kind, status, os),
    canOpenSettings: privacySettingsUrl(kind, os) !== null
  }
}
