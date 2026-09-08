/**
 * Records mono PCM from the default microphone, resampled to 16 kHz so it
 * can go straight into Whisper without a decode step in the main process.
 *
 * Uses ScriptProcessorNode rather than AudioWorklet because QuickAdd has no
 * bundler path for a separate worklet file, and the buffer sizes involved
 * (a few seconds of speech) do not need worklet latency.
 */

const TARGET_RATE = 16_000

export type RecorderState = 'idle' | 'recording' | 'busy'

export class PcmRecorder {
  private context: AudioContext | null = null
  private stream: MediaStream | null = null
  private processor: ScriptProcessorNode | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private chunks: Float32Array[] = []
  private _state: RecorderState = 'idle'

  get state() {
    return this._state
  }

  async start(): Promise<void> {
    if (this._state !== 'idle') return

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    })

    this.context = new AudioContext()
    this.source = this.context.createMediaStreamSource(this.stream)
    // 4096 keeps callback frequency low enough not to fight the input field.
    this.processor = this.context.createScriptProcessor(4096, 1, 1)
    this.chunks = []

    this.processor.onaudioprocess = (event) => {
      const input = event.inputBuffer.getChannelData(0)
      this.chunks.push(new Float32Array(input))
    }

    this.source.connect(this.processor)
    // Must connect to destination or Chrome suspends the processor. Gain 0
    // keeps the mic from looping back into speakers.
    const mute = this.context.createGain()
    mute.gain.value = 0
    this.processor.connect(mute)
    mute.connect(this.context.destination)

    this._state = 'recording'
  }

  /** Stops capture and returns mono float32 PCM at 16 kHz. */
  async stop(): Promise<Float32Array> {
    if (this._state !== 'recording' || !this.context) {
      this.cleanup()
      return new Float32Array(0)
    }

    this._state = 'busy'
    const sampleRate = this.context.sampleRate
    const chunks = this.chunks
    this.cleanup()

    const merged = merge(chunks)
    const pcm = sampleRate === TARGET_RATE ? merged : resample(merged, sampleRate, TARGET_RATE)
    this._state = 'idle'
    return pcm
  }

  cancel() {
    this.cleanup()
    this._state = 'idle'
  }

  private cleanup() {
    this.processor?.disconnect()
    this.source?.disconnect()
    this.stream?.getTracks().forEach((track) => track.stop())
    void this.context?.close()
    this.processor = null
    this.source = null
    this.stream = null
    this.context = null
    this.chunks = []
  }
}

function merge(chunks: Float32Array[]): Float32Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const out = new Float32Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.length
  }
  return out
}

/** Linear resample — good enough for speech; Whisper is robust to it. */
function resample(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return input
  const ratio = fromRate / toRate
  const outLength = Math.max(1, Math.round(input.length / ratio))
  const out = new Float32Array(outLength)
  for (let i = 0; i < outLength; i++) {
    const src = i * ratio
    const left = Math.floor(src)
    const right = Math.min(left + 1, input.length - 1)
    const frac = src - left
    out[i] = input[left]! * (1 - frac) + input[right]! * frac
  }
  return out
}
