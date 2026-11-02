import type { Os } from './shortcuts'

export type PermissionKind = 'microphone' | 'screen' | 'accessibility'

/** Electron's `systemPreferences.getMediaAccessStatus`, plus 'unknown' where it has no answer. */
export type AccessStatus = 'granted' | 'denied' | 'restricted' | 'not-determined' | 'unknown'

export interface PermissionState {
  kind: PermissionKind
  status: AccessStatus
  /** What to tell the user; null when there is nothing to fix. */
  help: string | null
  canOpenSettings: boolean
}

const MAC_PANE = 'x-apple.systempreferences:com.apple.preference.security'

const MAC_ANCHORS: Record<PermissionKind, string> = {
  microphone: 'Privacy_Microphone',
  screen: 'Privacy_ScreenCapture',
  accessibility: 'Privacy_Accessibility'
}

export function privacySettingsUrl(kind: PermissionKind, os: Os): string | null {
  if (os === 'mac') return `${MAC_PANE}?${MAC_ANCHORS[kind]}`
  if (os === 'win' && kind === 'microphone') return 'ms-settings:privacy-microphone'
  return null
}

const MAC_PANE_NAMES: Record<PermissionKind, string> = {
  microphone: 'Microphone',
  screen: 'Screen & System Audio Recording',
  accessibility: 'Accessibility'
}

const PURPOSE: Record<PermissionKind, string> = {
  microphone: 'Voice capture needs the microphone',
  screen: 'Capturing the screen needs Screen Recording permission',
  accessibility: 'Reading the window in front needs Accessibility permission'
}

export function permissionHelp(kind: PermissionKind, status: AccessStatus, os: Os): string | null {
  // Granted needs nothing, and an undecided permission is asked on first use.
  if (status === 'granted' || status === 'not-determined' || status === 'unknown') return null
  if (status === 'restricted') {
    return `${PURPOSE[kind]}, and it is blocked on this computer, usually by an administrator or device management profile.`
  }
  if (os === 'mac') {
    return `${PURPOSE[kind]}. Turn on AmbientMind in System Settings → Privacy & Security → ${MAC_PANE_NAMES[kind]}.`
  }
  if (os === 'win' && kind === 'microphone') {
    return `${PURPOSE[kind]}. Turn on microphone access for desktop apps in Settings → Privacy & security → Microphone.`
  }
  return `${PURPOSE[kind]}, and it was refused.`
}

/** The permissions worth showing on each OS; Accessibility is a Mac idea. */
export function permissionKinds(os: Os): PermissionKind[] {
  return os === 'mac' ? ['microphone', 'screen', 'accessibility'] : ['microphone', 'screen']
}
