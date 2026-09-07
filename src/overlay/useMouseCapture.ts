import { useEffect } from 'react'

export const INTERACTIVE_ATTR = 'data-ambient-interactive'

/**
 * The overlay is click-through by default so it never blocks the apps beneath
 * it. Electron forwards mousemove even while ignoring clicks, so we hit-test
 * each move and ask the main process for capture only while the cursor is over
 * something the user can actually act on.
 *
 * Hit-testing has to happen here rather than via React's onMouseEnter, because
 * while the window is ignoring mouse events the elements never receive
 * enter/leave pairs at all.
 */
export function useMouseCapture() {
  useEffect(() => {
    let capturing = false
    let frame = 0

    const apply = (next: boolean) => {
      if (next === capturing) return
      capturing = next
      window.ambient.setMouseCapture(next)
    }

    const onMove = (event: MouseEvent) => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        const target = document.elementFromPoint(event.clientX, event.clientY)
        apply(Boolean(target?.closest(`[${INTERACTIVE_ATTR}]`)))
      })
    }

    const onLeave = () => apply(false)

    window.addEventListener('mousemove', onMove)
    document.addEventListener('mouseleave', onLeave)
    window.addEventListener('blur', onLeave)

    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseleave', onLeave)
      window.removeEventListener('blur', onLeave)
      apply(false)
    }
  }, [])
}
