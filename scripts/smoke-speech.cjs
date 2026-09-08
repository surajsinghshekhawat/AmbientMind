/**
 * Smoke-tests local Whisper without opening the UI.
 *
 * Expects a 16-bit mono WAV at argv[2] (default: out/voice-test.wav).
 * Run under Electron so better-sqlite3-style native deps and app paths match
 * the real process: electron ./scripts/smoke-speech.cjs
 */
const { app } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

app.setName('ambientmind')
app.setPath('userData', path.join(app.getPath('appData'), 'ambientmind'))

function readWavPcm16(file) {
  const buf = fs.readFileSync(file)
  if (buf.toString('ascii', 0, 4) !== 'RIFF') throw new Error('not a WAV file')
  const channels = buf.readUInt16LE(22)
  const sampleRate = buf.readUInt32LE(24)
  const bits = buf.readUInt16LE(34)
  if (bits !== 16) throw new Error(`expected 16-bit PCM, got ${bits}`)

  // Find the data chunk; some writers insert a fact chunk before it.
  let offset = 12
  while (offset < buf.length) {
    const id = buf.toString('ascii', offset, offset + 4)
    const size = buf.readUInt32LE(offset + 4)
    if (id === 'data') {
      const pcm = buf.subarray(offset + 8, offset + 8 + size)
      const samples = new Float32Array(pcm.length / 2 / channels)
      for (let i = 0, s = 0; i < pcm.length; i += 2 * channels, s++) {
        samples[s] = pcm.readInt16LE(i) / 32768
      }
      return { samples, sampleRate }
    }
    offset += 8 + size
  }
  throw new Error('WAV has no data chunk')
}

function resample(input, fromRate, toRate) {
  if (fromRate === toRate) return input
  const ratio = fromRate / toRate
  const out = new Float32Array(Math.max(1, Math.round(input.length / ratio)))
  for (let i = 0; i < out.length; i++) {
    const src = i * ratio
    const left = Math.floor(src)
    const right = Math.min(left + 1, input.length - 1)
    const frac = src - left
    out[i] = input[left] * (1 - frac) + input[right] * frac
  }
  return out
}

app.whenReady().then(async () => {
  try {
    const wavPath = process.argv[2] || path.join(__dirname, '..', 'out', 'voice-test.wav')
    const { samples, sampleRate } = readWavPcm16(wavPath)
    const pcm = resample(samples, sampleRate, 16000)

    const { env, pipeline } = require('@xenova/transformers')
    env.cacheDir = path.join(app.getPath('userData'), 'whisper')
    console.log('SPEECH_CACHE', env.cacheDir)
    console.log('SPEECH_LOADING')
    const pipe = await pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny.en')
    console.log('SPEECH_READY', 'pcm_samples=', pcm.length)
    const result = await pipe(pcm, { sampling_rate: 16000 })
    console.log('SPEECH_TEXT', JSON.stringify(result.text))
    process.exit(0)
  } catch (err) {
    console.error('SPEECH_FAIL', err)
    process.exit(1)
  }
})
