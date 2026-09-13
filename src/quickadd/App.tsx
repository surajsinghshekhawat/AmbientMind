import { useEffect, useRef, useState } from 'react'
import { PcmRecorder } from './pcmRecorder'

type Status = 'idle' | 'recording' | 'transcribing' | 'error'

export function App() {
  const [value, setValue] = useState('')
  const [status, setStatus] = useState<Status>('idle')
  const [hint, setHint] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const recorderRef = useRef(new PcmRecorder())
  const finishingRef = useRef(false)

  const submit = (text: string) => {
    const trimmed = text.trim()
    if (!trimmed) return
    window.ambient.quickAdd.submit(trimmed)
    setValue('')
    setStatus('idle')
    setHint(null)
  }

  const finishRecording = async () => {
    if (finishingRef.current) return
    finishingRef.current = true
    window.ambient.quickAdd.setRecording(false)
    setStatus('transcribing')
    setHint('Transcribing…')

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
      submit(transcript)
    } catch (err) {
      console.error(err)
      setStatus('error')
      setHint((err as Error).message || 'Mic failed')
    } finally {
      finishingRef.current = false
    }
  }

  const startListening = async () => {
    finishingRef.current = false
    try {
      setHint(null)
      window.ambient.quickAdd.setRecording(true)
      await recorderRef.current.start({
        silenceMs: 3000,
        onSilence: () => void finishRecording()
      })
      setStatus('recording')
      setHint('Listening… pause 3s to stop')
    } catch (err) {
      window.ambient.quickAdd.setRecording(false)
      setStatus('error')
      setHint((err as Error).message || 'Microphone blocked')
    }
  }

  useEffect(
    () =>
      window.ambient.quickAdd.onOpened(() => {
        recorderRef.current.cancel()
        window.ambient.quickAdd.setRecording(false)
        finishingRef.current = false
        setValue('')
        setStatus('idle')
        setHint(null)
        inputRef.current?.focus()
        void startListening()
      }),
    []
  )

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      recorderRef.current.cancel()
      window.ambient.quickAdd.setRecording(false)
      window.ambient.quickAdd.cancel()
    } else if (event.key === 'Enter' && value.trim() && status === 'idle') {
      submit(value)
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
      <span
        className={`h-2.5 w-2.5 shrink-0 rounded-full ${
          status === 'recording' ? 'animate-pulse bg-urgency-overdue' : 'bg-white/20'
        }`}
      />
      <kbd className="shrink-0 rounded-md border border-white/15 px-2 py-1 text-[10px] text-white/40">
        {status === 'recording' ? 'Listening' : value.trim() ? 'Enter' : 'Esc'}
      </kbd>
    </div>
  )
}
