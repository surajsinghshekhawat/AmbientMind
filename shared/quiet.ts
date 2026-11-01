import type { BusyState } from './helperProtocol'

export type QuietReason = 'call' | 'fullscreen'

/**
 * Why AmbientMind should keep out of the way right now, or null. The mic is
 * ignored while Quick Capture itself is listening: that isn't a call.
 */
export function quietReason(busy: BusyState, listeningToUs: boolean): QuietReason | null {
  if (busy.micInUse && !listeningToUs) return 'call'
  if (busy.fullscreenApp) return 'fullscreen'
  return null
}

export function describeQuiet(reason: QuietReason, busy?: Pick<BusyState, 'fullscreenApp'>): string {
  if (reason === 'call') return 'Quiet during your call'
  return busy?.fullscreenApp ? `Quiet while ${busy.fullscreenApp} is full screen` : 'Quiet while an app is full screen'
}
