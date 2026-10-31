import type { OverlayCorner } from './types'

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export const OVERLAY_MARGIN = 16
/** The 48 px disc, its urgency arc and badge, and room to grow on hover. */
export const ORB_SIZE = 64
/** Used until the panel reports its real height. */
export const PANEL_START_HEIGHT = 160
const PANEL_MIN_HEIGHT = 96

/**
 * Where the overlay goes within one display's work area. The open panel is as
 * tall as its content, capped at the work area, and grows away from its corner.
 */
export function overlayBounds(options: {
  workArea: Rect
  corner: OverlayCorner
  width: number
  expanded: boolean
  contentHeight?: number
}): Rect {
  const { workArea, corner, expanded } = options
  const { x, y, width: aw, height: ah } = workArea
  const maxHeight = ah - OVERLAY_MARGIN * 2
  const w = expanded ? Math.min(options.width, aw - OVERLAY_MARGIN * 2) : ORB_SIZE
  const h = expanded
    ? Math.min(maxHeight, Math.max(PANEL_MIN_HEIGHT, options.contentHeight ?? PANEL_START_HEIGHT))
    : ORB_SIZE

  return {
    x: corner.endsWith('right') ? x + aw - w - OVERLAY_MARGIN : x + OVERLAY_MARGIN,
    y: corner.startsWith('bottom') ? y + ah - h - OVERLAY_MARGIN : y + OVERLAY_MARGIN,
    width: w,
    height: h
  }
}
