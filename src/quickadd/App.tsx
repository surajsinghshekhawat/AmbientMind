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
import { PcmRecorder } from './pcmRecorder'

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
}

export function App({ initialValue = '', initialPhase = 'typing', initialMessage }: Props = {}) {
  const [value, setValue] = useState(initialValue)
  const [phase, setPhase] = useState<Phase>(initialPhase)
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(initialMessage ?? null)
  const [levels, setLevels] = useState<number[]>(() =>
    initialPhase === 'listening' ? [0.2, 0.6, 0.9, 0.5, 0.3] : Array(BARS).fill(0)
  )
  const [shortcut, setShortcut] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const recorderRef = useRef(new PcmRecorder())
  const finishingRef = useRef(false)
  const phaseRef = useRef<Phase>('typing')
  phaseRef.current = phase

  const parsed = useMemo(() => (value.trim() ? parseCapture(value) : null), [value])

  useEffect(() => {
    void window.ambient.getShortcuts().then((list) => {
      setShortcut(list.find((s) => s.action === 'quickAdd')?.label ?? null)
    })
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
    window.ambient.quickAdd.setRecording(false)
    finishingRef.current = false
    setValue('')
    setPhase('typing')
    setMessage(null)
    requestAnimationFrame(() => inputRef.current?.focus())
  }, [])

  const save = useCallback(
    (keepOpen: boolean) => {
      const text = inputRef.current?.value.trim() ?? ''
      if (!text || phaseRef.current !== 'typing') return
      setPhase('saved')
      setTimeout(() => {
        window.ambient.quickAdd.submit(text, { keepOpen })
        if (keepOpen) reset()
      }, SAVED_MS)
    },
    [reset]
  )

  const finishListening = useCallback(async () => {
    if (finishingRef.current) return
    finishingRef.current = true
    window.ambient.quickAdd.setRecording(false)
    setPhase('transcribing')
    try {
      const pcm = await recorderRef.current.stop()
      const copy = pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength)
      const transcript = (await window.ambient.quickAdd.transcribe(copy as ArrayBuffer)).trim()
      setPhase('typing')
      if (!transcript) {
        setMessage({ text: 'Didn’t catch that. Try again, or type it.' })
      } else {
        // Shown for a look before saving; voice gets the same chips as typing.
        setValue((current) => (current.trim() ? `${current.trim()} ${transcript}` : transcript))
        setMessage(null)
      }
    } catch (err) {
      console.error(err)
      setPhase('typing')
      setMessage({ text: (err as Error).message || 'The microphone stopped.', error: true })
    } finally {
      finishingRef.current = false
      setLevels(Array(BARS).fill(0))
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [])

  const startListening = useCallback(async () => {
    if (phaseRef.current !== 'typing') return
    finishingRef.current = false
    setMessage(null)
    window.ambient.quickAdd.setRecording(true)
    try {
      await recorderRef.current.start({
        silenceMs: 2500,
        onSilence: () => void finishListening(),
        onLevel: (rms) => setLevels((prev) => [...prev.slice(1), Math.min(1, rms * 9)])
      })
      setPhase('listening')
    } catch (err) {
      window.ambient.quickAdd.setRecording(false)
      setPhase('typing')
      setMessage({ text: (err as Error).message || 'The microphone is blocked.', error: true })
    }
  }, [finishListening])

  const toggleMic = useCallback(() => {
    if (phaseRef.current === 'listening') void finishListening()
    else void startListening()
  }, [finishListening, startListening])

  useEffect(() => window.ambient.quickAdd.onOpened(reset), [reset])
  useEffect(() => window.ambient.quickAdd.onShortcutAgain(toggleMic), [toggleMic])
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      recorderRef.current.cancel()
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
  const status =
    phase === 'listening'
      ? shortcut
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
              value={value}
              onChange={(event) => {
                setValue(event.target.value)
                if (message) setMessage(null)
              }}
              placeholder={listening ? '' : 'What needs doing?'}
              aria-label="What needs doing?"
              spellCheck={false}
              readOnly={phase === 'transcribing'}
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
