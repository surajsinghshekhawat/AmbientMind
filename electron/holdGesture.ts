/**
 * The Quick Capture shortcut, now that the helper reports key release:
 *
 *   press and release      opens Quick Capture, or toggles the mic if open
 *   press and hold         talks while held; letting go writes it down
 *
 * Plain logic over injected actions and timers, so it is tested without
 * Electron or a keyboard.
 */
export interface HoldActions {
  isOpen: () => boolean
  open: () => void
  toggleMic: () => void
  holdStart: () => void
  holdEnd: () => void
}

export const HOLD_MS = 300

export class HoldGesture {
  private pressed = false
  private held = false
  private openedByPress = false
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private readonly actions: HoldActions,
    private readonly holdMs = HOLD_MS,
    private readonly timers: { set: typeof setTimeout; clear: typeof clearTimeout } = { set: setTimeout, clear: clearTimeout }
  ) {}

  down() {
    // Key repeat, or a down whose up was lost: one press at a time.
    if (this.pressed) return
    this.pressed = true
    this.held = false
    this.openedByPress = !this.actions.isOpen()
    if (this.openedByPress) this.actions.open()
    this.timer = this.timers.set(() => {
      this.timer = null
      this.held = true
      this.actions.holdStart()
    }, this.holdMs)
  }

  up() {
    if (!this.pressed) return
    this.pressed = false
    if (this.timer) this.timers.clear(this.timer)
    this.timer = null
    if (this.held) {
      this.held = false
      this.actions.holdEnd()
    } else if (!this.openedByPress) {
      this.actions.toggleMic()
    }
  }

  /** The hotkey went away mid-press (helper restart, shortcut changed). */
  reset() {
    if (this.timer) this.timers.clear(this.timer)
    const wasHeld = this.held
    this.timer = null
    this.pressed = false
    this.held = false
    if (wasHeld) this.actions.holdEnd()
  }
}
