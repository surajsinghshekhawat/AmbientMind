/**
 * Ends a recording once the speaker has stopped: after speech was heard and
 * the level has stayed low for `silenceMs`, or at `maxMs` regardless. Fed
 * input levels (RMS of a block of samples) with their times.
 */
export class SilenceGate {
  private startedAt: number | null = null
  private lastLoudAt = 0
  private heardSpeech = false
  private done = false

  constructor(
    private readonly options: {
      silenceMs: number
      maxMs?: number
      /** Opening the mic often spikes, which is not speech. */
      warmupMs?: number
      threshold?: number
    }
  ) {}

  /** True exactly once: when the recording should stop. */
  push(rms: number, now: number): boolean {
    if (this.done) return false
    this.startedAt ??= now
    const elapsed = now - this.startedAt
    if (elapsed >= (this.options.maxMs ?? 25_000)) return this.finish()
    if (elapsed < (this.options.warmupMs ?? 400)) return false
    if (rms > (this.options.threshold ?? 0.018)) {
      this.heardSpeech = true
      this.lastLoudAt = now
      return false
    }
    if (this.heardSpeech && now - this.lastLoudAt >= this.options.silenceMs) return this.finish()
    return false
  }

  private finish(): boolean {
    this.done = true
    return true
  }
}
