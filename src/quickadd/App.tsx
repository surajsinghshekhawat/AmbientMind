import { useEffect, useRef, useState } from 'react'
import { PcmRecorder } from './pcmRecorder'

type Status = 'idle' | 'recording' | 'transcribing' | 'error'

export function App() {
  const [value, setValue] = useState('')
  const [status, setStatus] = useState<Status>('idle')
  const [hint, setHint] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const recorderRef = useRef(new PcmRecorder())

  // The window is hidden rather than destroyed between invocations, so the
  // renderer keeps its state and has to be reset each time it is shown.
  useEffect(
    () =>
      window.ambient.quickAdd.onOpened(() => {
        recorderRef.current.cancel()
        window.ambient.quickAdd.setRecording(false)
        setValue('')
        setStatus('idle')
        setHint(null)
        inputRef.current?.focus()
      }),
    []
  )

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const submit = (text: string) => {
    const trimmed = text.trim()
    if (!trimmed) return
    window.ambient.quickAdd.submit(trimmed)
    setValue('')
    setStatus('idle')
    setHint(null)
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      recorderRef.current.cancel()
      window.ambient.quickAdd.setRecording(false)
      window.ambient.quickAdd.cancel()
    } else if (event.key === 'Enter' && value.trim() && status === 'idle') {
      submit(value)
    }
  }

  const toggleMic = async () => {
    if (status === 'transcribing') return

    if (status === 'recording') {
      setStatus('transcribing')
      setHint('Transcribing…')
      window.ambient.quickAdd.setRecording(false)

      try {
        const pcm = await recorderRef.current.stop()
        const copy = pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength)
        const transcript = await window.ambient.quickAdd.transcribe(copy as ArrayBuffer)
        if (!transcript) {
          setStatus('error')
          setHint('Heard nothing — try again')
          return
        }
        setValue(transcript)
        setStatus('idle')
        setHint(null)
        // Auto-submit so voice feels like one gesture, not type-then-enter.
        submit(transcript)
      } catch (err) {
        console.error(err)
        setStatus('error')
        setHint((err as Error).message || 'Mic failed')
      }
      return
    }

    try {
      setHint(null)
      window.ambient.quickAdd.setRecording(true)
      await recorderRef.current.start()
      setStatus('recording')
      setHint('Listening… click mic to stop')
    } catch (err) {
      window.ambient.quickAdd.setRecording(false)
      setStatus('error')
      setHint((err as Error).message || 'Microphone blocked')
    }
  }

  return (
    <div className="flex h-full items-center gap-3 rounded-2xl border border-white/15 bg-black/70 px-4 backdrop-blur-xl">
      <span className="text-[11px] font-medium tracking-[0.18em] text-white/35 uppercase">
        Add
      </span>
      <input
        ref={inputRef}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder={hint ?? 'What needs doing?'}
        spellCheck={false}
        disabled={status === 'recording' || status === 'transcribing'}
        className="min-w-0 flex-1 bg-transparent text-[15px] text-white/95 placeholder:text-white/30 focus:outline-none disabled:opacity-70"
      />
      <button
        type="button"
        onClick={() => void toggleMic()}
        aria-label={status === 'recording' ? 'Stop listening' : 'Speak a task'}
        title={status === 'recording' ? 'Stop' : 'Hold-free push to talk'}
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full border transition-colors ${
          status === 'recording'
            ? 'animate-pulse border-urgency-urgent/80 bg-urgency-urgent/25 text-white'
            : status === 'transcribing'
              ? 'border-white/20 bg-white/10 text-white/50'
              : 'border-white/15 bg-white/5 text-white/70 hover:bg-white/10 hover:text-white'
        }`}
      >
        <MicIcon />
      </button>
      <kbd className="shrink-0 rounded-md border border-white/15 px-2 py-1 text-[10px] text-white/40">
        {status === 'recording' ? 'Mic' : value.trim() ? 'Enter' : 'Esc'}
      </kbd>
    </div>
  )
}

function MicIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 3a3 3 0 0 0-3 3v6a3 3 0 1 0 6 0V6a3 3 0 0 0-3-3Z"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path
        d="M5 11a7 7 0 0 0 14 0M12 18v3"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  )
}
