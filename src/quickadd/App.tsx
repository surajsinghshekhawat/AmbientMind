import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Check, CalendarClock, Flag, Mic, MonitorUp, Repeat, Square, UserRound } from 'lucide-react'
import { parseCapture } from '@shared/capture'
import type { OrbLook } from '@shared/orb'
import { describeRule } from '@shared/recurrence'
import { cn } from '@/ui/cn'
import { IconButton } from '@/ui/IconButton'
import { Kbd } from '@/ui/Kbd'
import { Orb } from '@/ui/Orb'
import { StatusLine } from '@/ui/StatusLine'
import { SilenceGate } from '@shared/silence'
import type { SpeechEngineInfo } from '@shared/types'
import { PcmRecorder } from './pcmRecorder'

/** An IPC rejection carries Electron's wrapper text; the user needs only the reason. */
function ipcMessage(err: unknown): string {
  return ((err as Error)?.message ?? '').replace(/^Error invoking remote method '[^']+': (\w*Error: )?/, '')
}

type Phase = 'typing' | 'listening' | 'transcribing' | 'saved'

/** Long enough to read as "done", short enough not to be in the way. */
const SAVED_MS = 420
const BARS = 5

function look(phase: Phase): OrbLook {
  const motion = phase === 'listening' ? 'listening' : phase === 'transcribing' ? 'composing' : 'breathing'
  return { motion, calm: phase === 'typing', arc: null, badge: null, attention: false, peek: '' }
}

function Chip({ icon, children, tone }: { icon: ReactNode; children: ReactNode; tone?: 'danger' | undefined }) {
  return (
    <span
      className={cn(
        'inline-flex h-6 animate-fade items-center gap-1.5 rounded-full bg-fill-2 pr-2.5 pl-2 text-small hairline [&_svg]:size-3.5 [&_svg]:stroke-2',
        tone === 'danger' ? 'text-danger' : 'text-ink-2'
      )}
    >
      {icon}
      {children}
    </span>
  )
}

interface Props {
  /** For the gallery: start in a given state. */
  initialValue?: string
  initialPhase?: Phase
  initialMessage?: { text: string; error?: boolean }
  initialPartial?: string
  initialHolding?: boolean
}

export function App({
  initialValue = '',
  initialPhase = 'typing',
  initialMessage,
  initialPartial = '',
  initialHolding = false
}: Props = {}) {
  const [value, setValue] = useState(initialValue)
  const [phase, setPhase] = useState<Phase>(initialPhase)
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(initialMessage ?? null)
  const [levels, setLevels] = useState<number[]>(() =>
    initialPhase === 'listening' ? [0.2, 0.6, 0.9, 0.5, 0.3] : Array(BARS).fill(0)
  )
  const [shortcut, setShortcut] = useState<string | null>(null)
  /** Words heard so far, while Apple's live speech is listening. */
  const [partial, setPartial] = useState(initialPartial)
  const [holding, setHolding] = useState(initialHolding)
  const inputRef = useRef<HTMLInputElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const recorderRef = useRef(new PcmRecorder())
  const finishingRef = useRef(false)
  const spokenRef = useRef(false)
  const phaseRef = useRef<Phase>('typing')
  phaseRef.current = phase
  const engineRef = useRef<SpeechEngineInfo['engine']>('whisper')
  /** The session in progress is Apple's, and how to stop listening to it. */
  const liveRef = useRef<(() => void) | null>(null)
  const startingRef = useRef<Promise<void> | null>(null)
  const holdingRef = useRef(false)

  const parsed = useMemo(() => (value.trim() ? parseCapture(value) : null), [value])

  const checkEngine = useCallback(() => {
    void window.ambient.speech.engine().then((info) => (engineRef.current = info.engine))
  }, [])

  useEffect(() => {
    void window.ambient.getShortcuts().then((list) => {
      setShortcut(list.find((s) => s.action === 'quickAdd')?.label ?? null)
    })
    checkEngine()
  }, [checkEngine])

  const endLive = useCallback((cancel: boolean) => {
    if (!liveRef.current) return
    liveRef.current()
    liveRef.current = null
    if (cancel) window.ambient.speech.cancel()
  }, [])

  useLayoutEffect(() => {
    const card = cardRef.current
    if (!card) return
    const report = () => window.ambient.quickAdd.setHeight(card.offsetHeight + 2)
    report()
    const observer = new ResizeObserver(report)
    observer.observe(card)
    return () => observer.disconnect()
  }, [])

  const reset = useCallback(() => {
    recorderRef.current.cancel()
    endLive(true)
    window.ambient.quickAdd.setRecording(false)
    finishingRef.current = false
    holdingRef.current = false
    setHolding(false)
    setPartial('')
    setValue('')
    spokenRef.current = false
    setPhase('typing')
    setMessage(null)
    checkEngine()
    requestAnimationFrame(() => inputRef.current?.focus())
  }, [checkEngine, endLive])

  const save = useCallback(
    (keepOpen: boolean) => {
      const text = inputRef.current?.value.trim() ?? ''
      if (!text || phaseRef.current !== 'typing') return
      setPhase('saved')
      setTimeout(() => {
        window.ambient.quickAdd.submit(text, spokenRef.current ? { keepOpen, spoken: true } : { keepOpen })
        if (keepOpen) reset()
      }, SAVED_MS)
    },
    [reset]
  )

  const finishListening = useCallback(async () => {
    if (finishingRef.current || phaseRef.current !== 'listening') return
    finishingRef.current = true
    holdingRef.current = false
    setHolding(false)
    window.ambient.quickAdd.setRecording(false)
    setPhase('transcribing')
    try {
      let transcript: string
      if (liveRef.current) {
        endLive(false)
        await startingRef.current?.catch(() => {})
        transcript = (await window.ambient.speech.stop()).trim()
      } else {
        const pcm = await recorderRef.current.stop()
        const copy = pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength)
        transcript = (await window.ambient.quickAdd.transcribe(copy as ArrayBuffer)).trim()
      }
      setPartial('')
      setPhase('typing')
      if (!transcript) {
        setMessage({ text: 'Didn’t catch that. Try again, or type it.' })
      } else {
        // Shown for a look before saving; voice gets the same chips as typing.
        setValue((current) => (current.trim() ? `${current.trim()} ${transcript}` : transcript))
        spokenRef.current = true
        setMessage(null)
      }
    } catch (err) {
      console.error(err)
      setPartial('')
      setPhase('typing')
      setMessage({ text: ipcMessage(err) || 'The microphone stopped.', error: true })
    } finally {
      finishingRef.current = false
      setLevels(Array(BARS).fill(0))
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [endLive])

  const pushLevel = useCallback((rms: number) => setLevels((prev) => [...prev.slice(1), Math.min(1, rms * 9)]), [])

  /** Apple's live speech; false when it is not available or would not start. */
  const startLive = useCallback(async (): Promise<boolean> => {
    if (engineRef.current !== 'apple') return false
    // Held, the key decides when to stop; silence only ends a tapped session.
    const gate = new SilenceGate({ silenceMs: 2500 })
    const offLevel = window.ambient.speech.onLevel((rms) => {
      pushLevel(rms)
      if (!holdingRef.current && gate.push(rms, Date.now())) void finishListening()
    })
    const offPartial = window.ambient.speech.onPartial(({ text }) => setPartial(text))
    liveRef.current = () => {
      offLevel()
      offPartial()
    }
    try {
      const started = window.ambient.speech.start()
      startingRef.current = started
      await started
      return true
    } catch (err) {
      console.warn('[speech] live speech did not start; using Whisper:', err)
      endLive(false)
      return false
    }
  }, [endLive, finishListening, pushLevel])

  const startListening = useCallback(
    async (hold = false) => {
      if (phaseRef.current !== 'typing') return
      finishingRef.current = false
      holdingRef.current = hold
      setHolding(hold)
      setMessage(null)
      setPartial('')
      window.ambient.quickAdd.setRecording(true)
      // Listening from here on, so a release during start-up still stops it.
      setPhase('listening')
      phaseRef.current = 'listening'
      try {
        if (!(await startLive())) {
          await recorderRef.current.start({
            silenceMs: 2500,
            onSilence: () => {
              if (!holdingRef.current) void finishListening()
            },
            onLevel: pushLevel
          })
        }
      } catch (err) {
        window.ambient.quickAdd.setRecording(false)
        holdingRef.current = false
        setHolding(false)
        setPhase('typing')
        setMessage({ text: ipcMessage(err) || 'The microphone is blocked.', error: true })
      }
    },
    [finishListening, pushLevel, startLive]
  )

  const toggleMic = useCallback(() => {
    if (phaseRef.current === 'listening') void finishListening()
    else void startListening()
  }, [finishListening, startListening])

  const onHold = useCallback(
    (state: 'start' | 'end') => {
      if (state === 'end') return void finishListening()
      if (phaseRef.current === 'listening') {
        holdingRef.current = true
        setHolding(true)
      } else {
        void startListening(true)
      }
    },
    [finishListening, startListening]
  )

  useEffect(() => window.ambient.quickAdd.onOpened(reset), [reset])
  useEffect(() => window.ambient.quickAdd.onShortcutAgain(toggleMic), [toggleMic])
  useEffect(() => window.ambient.quickAdd.onHold(onHold), [onHold])
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      recorderRef.current.cancel()
      endLive(true)
      window.ambient.quickAdd.setRecording(false)
      window.ambient.quickAdd.cancel()
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      save(event.metaKey || event.ctrlKey)
      return
    }
    if (event.key.toLowerCase() === 'l' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      toggleMic()
    }
  }

  const listening = phase === 'listening'
  const live = (listening || phase === 'transcribing') && partial !== ''
  const shown = live ? [value.trim(), partial].filter(Boolean).join(' ') : value
  const status =
    phase === 'listening'
      ? holding
        ? 'Listening… let go to stop'
        : shortcut
          ? `Listening… press ${shortcut} again to stop`
          : 'Listening…'
      : phase === 'transcribing'
        ? 'Writing it down…'
        : null

  const chips: ReactNode[] = []
  if (parsed?.screen) chips.push(<Chip key="screen" icon={<MonitorUp />}>Reads your screen</Chip>)
  if (parsed?.recurrence) chips.push(<Chip key="rec" icon={<Repeat />}>{describeRule(parsed.recurrence)}</Chip>)
  if (parsed?.deadlineLabel) chips.push(<Chip key="due" icon={<CalendarClock />}>{parsed.deadlineLabel}</Chip>)
  if (parsed?.priority && parsed.priority !== 'medium') {
    chips.push(
      <Chip key="pri" icon={<Flag />} tone={parsed.priority === 'urgent' ? 'danger' : undefined}>
        {parsed.priority === 'urgent' ? 'Urgent' : parsed.priority === 'high' ? 'High priority' : 'Low priority'}
      </Chip>
    )
  }
  for (const person of parsed?.people ?? []) chips.push(<Chip key={`p-${person}`} icon={<UserRound />}>{person}</Chip>)

  return (
    <div className="p-px" onKeyDown={onKeyDown}>
      <div ref={cardRef} className="glass flex animate-pop flex-col px-2 py-1.5">
        <div className="flex h-12 items-center gap-1">
          <span className="grid size-10 shrink-0 place-items-center">
            {phase === 'saved' ? (
              <span className="grid size-7 animate-[pop_0.35s_var(--ease-spring)_both] place-items-center rounded-full bg-success text-black/80">
                <Check aria-hidden className="size-4 stroke-[3]" />
              </span>
            ) : (
              <Orb look={look(phase)} size={36} bare />
            )}
          </span>
          {phase === 'saved' ? (
            <p role="status" className="flex-1 animate-fade truncate text-title text-ink-2">
              Added
            </p>
          ) : (
            <input
              ref={inputRef}
              value={shown}
              onChange={(event) => {
                setValue(event.target.value)
                if (message) setMessage(null)
              }}
              placeholder={listening ? '' : 'What needs doing?'}
              aria-label="What needs doing?"
              spellCheck={false}
              readOnly={phase === 'transcribing' || live}
              className="h-full min-w-0 flex-1 bg-transparent text-title text-ink-1 outline-none placeholder:text-ink-4"
            />
          )}
          {listening && (
            <span aria-hidden className="flex h-6 items-center gap-[3px] px-1">
              {levels.map((level, i) => (
                <i
                  key={i}
                  className="block w-[3px] rounded-full bg-accent transition-[height] duration-100"
                  style={{ height: `${4 + level * 18}px` }}
                />
              ))}
            </span>
          )}
          {phase !== 'saved' && (
            <IconButton
              label={listening ? 'Stop listening (⌘L)' : 'Talk (⌘L)'}
              active={listening}
              onClick={toggleMic}
              disabled={phase === 'transcribing'}
              tone={listening ? 'accent' : undefined}
            >
              {listening ? <Square /> : <Mic />}
            </IconButton>
          )}
          {phase === 'typing' && value.trim() && <Kbd className="mr-1">↵</Kbd>}
        </div>

        {(chips.length > 0 || status || message) && phase !== 'saved' && (
          <div className="flex min-h-7 flex-wrap items-center gap-1.5 pb-1.5 pl-11">
            {status ? (
              <StatusLine text={status} live />
            ) : message ? (
              <p role="status" className={cn('text-small', message.error ? 'text-danger' : 'text-ink-3')}>
                {message.text}
              </p>
            ) : (
              chips
            )}
          </div>
        )}
      </div>
    </div>
  )
}
