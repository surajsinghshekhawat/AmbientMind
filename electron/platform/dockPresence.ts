/**
 * The Mac app lives in the menu bar, but a normal window without a Dock icon
 * cannot be found again with ⌘Tab. Windows that need one hold a claim; the
 * icon goes away when the last claim is released.
 */
export class DockPresence {
  /**
   * Electron ignores dock.hide() within a second of dock.show(), to avoid a
   * macOS bug that leaves duplicate icons, so an early hide is deferred.
   */
  static readonly SETTLE_MS = 1100

  private readonly holders = new Set<string>()
  private visible = false
  private shownAt = 0
  private readonly now: () => number
  private readonly later: (fn: () => void, ms: number) => void

  constructor(
    private readonly dock: {
      show: () => void
      hide: () => void
      now?: () => number
      later?: (fn: () => void, ms: number) => void
    }
  ) {
    this.now = dock.now ?? Date.now
    this.later = dock.later ?? ((fn, ms) => void setTimeout(fn, ms))
  }

  open(holder: string) {
    if (this.holders.has(holder)) return
    this.holders.add(holder)
    if (this.visible) return
    this.visible = true
    this.shownAt = this.now()
    this.dock.show()
  }

  close(holder: string) {
    if (!this.holders.delete(holder) || this.holders.size > 0) return
    const wait = this.shownAt + DockPresence.SETTLE_MS - this.now()
    if (wait > 0) this.later(() => this.hideIfUnclaimed(), wait)
    else this.hideIfUnclaimed()
  }

  private hideIfUnclaimed() {
    if (this.holders.size > 0 || !this.visible) return
    this.visible = false
    this.dock.hide()
  }
}
