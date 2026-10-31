import type { Os } from './shortcuts'

export type MediaKind = 'microphone' | 'screen'

/** Electron's `systemPreferences.getMediaAccessStatus`, plus 'unknown' where it has no answer. */
export type AccessStatus = 'granted' | 'denied' | 'restricted' | 'not-determined' | 'unknown'

export interface PermissionState {
  kind: MediaKind
  status: AccessStatus
  /** What to tell the user; null when there is nothing to fix. */
  help: string | null
  canOpenSettings: boolean
}

const MAC_PANE = 'x-apple.systempreferences:com.apple.preference.security'

export function privacySettingsUrl(kind: MediaKind, os: Os): string | null {
  if (os === 'mac') {
    return `${MAC_PANE}?${kind === 'screen' ? 'Privacy_ScreenCapture' : 'Privacy_Microphone'}`
  }
  if (os === 'win' && kind === 'microphone') return 'ms-settings:privacy-microphone'
  return null
}

const MAC_PANE_NAMES: Record<MediaKind, string> = {
  microphone: 'Microphone',
  screen: 'Screen & System Audio Recording'
}

const PURPOSE: Record<MediaKind, string> = {
  microphone: 'Voice capture needs the microphone',
  screen: 'Capturing the screen needs Screen Recording permission'
}

export function permissionHelp(kind: MediaKind, status: AccessStatus, os: Os): string | null {
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
