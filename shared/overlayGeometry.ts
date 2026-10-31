import type { OverlayCorner } from './types'

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export const OVERLAY_MARGIN = 24
/** Matches the 64px disc + 3px ring. */
export const ORB_SIZE = 70

/** Where the overlay goes within one display's work area. */
export function overlayBounds(options: {
  workArea: Rect
  corner: OverlayCorner
  width: number
  expanded: boolean
}): Rect {
  const { workArea, corner, expanded } = options
  const { x, y, width: aw, height: ah } = workArea
  const w = expanded ? Math.min(options.width, aw - OVERLAY_MARGIN * 2) : ORB_SIZE
  const h = expanded ? ah - OVERLAY_MARGIN * 2 : ORB_SIZE

  return {
    x: corner.endsWith('right') ? x + aw - w - OVERLAY_MARGIN : x + OVERLAY_MARGIN,
    y: corner.startsWith('bottom') && !expanded ? y + ah - h - OVERLAY_MARGIN : y + OVERLAY_MARGIN,
    width: w,
    height: h
  }
}
