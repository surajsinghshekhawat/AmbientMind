import { useCallback, useEffect, useMemo, useState } from 'react'
import { findClashes } from '@shared/clash'
import type { HealthReport, OverlayCorner, RecurrenceSuggestion, Task } from '@shared/types'
import { DEFAULT_CONFIG } from '@shared/types'
import { HealthBanner } from './HealthBanner'
import { Orb } from './Orb'
import { SuggestionCard } from './SuggestionCard'
import { TaskList } from './TaskList'
import { INTERACTIVE_ATTR, useMouseCapture } from './useMouseCapture'

const CLOCK_TICK_MS = 30_000
/** Ollama gets started after the app often enough to be worth re-checking. */
const HEALTH_POLL_MS = 60_000

export function App() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [maxVisible, setMaxVisible] = useState(DEFAULT_CONFIG.maxTasksVisible)
  const [corner, setCorner] = useState<OverlayCorner>(DEFAULT_CONFIG.overlayCorner)
  const [now, setNow] = useState(() => Date.now())
  const [expanded, setExpanded] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [health, setHealth] = useState<HealthReport | null>(null)
  const [suggestions, setSuggestions] = useState<RecurrenceSuggestion[]>([])
  // Recomputed from the same tasks the list renders, so the advice can never
  // disagree with what is on screen.
  const clash = useMemo(() => findClashes(tasks, { now })[0] ?? null, [tasks, now])
  const [connecting, setConnecting] = useState(false)

  useMouseCapture()

  useEffect(() => {
    void window.ambient.getConfig().then((config) => {
      setMaxVisible(config.maxTasksVisible)
      setCorner(config.overlayCorner)
    })
    return window.ambient.onConfigChanged((config) => {
      setMaxVisible(config.maxTasksVisible)
      setCorner(config.overlayCorner)
    })
  }, [])

  useEffect(() => {
    void window.ambient.getTasks().then(setTasks)
    return window.ambient.onTasksChanged(setTasks)
  }, [])

  useEffect(() => window.ambient.onSyncStatus((s) => setSyncing(s.state === 'running')), [])

  const refreshHealth = useCallback(() => {
    void window.ambient.getHealth().then(setHealth)
  }, [])

  useEffect(() => {
    refreshHealth()
    const id = setInterval(refreshHealth, HEALTH_POLL_MS)
    return () => clearInterval(id)
  }, [refreshHealth])

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), CLOCK_TICK_MS)
    return () => clearInterval(id)
  }, [])

  useEffect(() => window.ambient.onOverlayExpanded(setExpanded), [])

  const setOpen = useCallback((next: boolean) => {
    void window.ambient.setOverlayExpanded(next)
  }, [])

  const onComplete = useCallback((id: string) => {
    void window.ambient.completeTask(id).then(setTasks)
  }, [])

  const onEdit = useCallback((id: string, title: string) => {
    void window.ambient.updateTask(id, { title }).then(setTasks)
  }, [])

  const onSnooze = useCallback((id: string, until: string) => {
    void window.ambient.snoozeTask(id, until).then(setTasks)
  }, [])

  const onDelete = useCallback((id: string) => {
    void window.ambient.deleteTask(id).then(setTasks)
  }, [])

  // Only asked about while the list is open; a suggestion is not urgent enough
  // to interrupt anything.
  useEffect(() => {
    if (!expanded) return
    void window.ambient.rules.suggestions().then(setSuggestions)
  }, [expanded])

  const acceptSuggestion = useCallback((id: string) => {
    void window.ambient.rules.acceptSuggestion(id).then((result) => {
      setSuggestions(result.suggestions)
      void window.ambient.getTasks().then(setTasks)
    })
  }, [])

  const dismissSuggestion = useCallback((id: string) => {
    void window.ambient.rules.dismissSuggestion(id).then(setSuggestions)
  }, [])

  const connectGoogle = useCallback(async () => {
    setConnecting(true)
    try {
      await window.ambient.accounts.connect()
      refreshHealth()
    } catch (err) {
      console.error(err)
    } finally {
      setConnecting(false)
    }
  }, [refreshHealth])

  const orbAtBottom = corner.startsWith('bottom')
  const orbAtRight = corner.endsWith('right')

  const orb = (
    <Orb
      tasks={tasks}
      now={now}
      expanded={expanded}
      onToggle={() => setOpen(!expanded)}
    />
  )

  if (!expanded) {
    return <div className="flex h-full w-full items-center justify-center">{orb}</div>
  }

  return (
    <div className={`flex h-full flex-col ${orbAtBottom ? 'flex-col-reverse' : ''}`}>
      <div
        className={`flex shrink-0 p-2 ${orbAtRight ? 'justify-end' : 'justify-start'}`}
      >
        {orb}
      </div>
      <div
        {...{ [INTERACTIVE_ATTR]: '' }}
        className="flex min-h-0 flex-1 flex-col gap-2 px-1 pb-2"
      >
        <div className="flex items-center gap-2 px-3">
          <header className="min-w-0 flex-1 text-[10px] font-medium tracking-[0.18em] text-white/35 uppercase">
            AmbientMind
            {syncing && (
              <span className="ml-2 font-normal tracking-normal text-urgency-approaching normal-case">
                · syncing
              </span>
            )}
          </header>
          <button
            type="button"
            onClick={() => window.ambient.openSettings()}
            title="Settings"
            className="rounded px-1.5 text-[11px] text-white/35 hover:text-white/70"
          >
            ⚙
          </button>
        </div>
        {health && !health.ok && (
          <HealthBanner
            health={health}
            connecting={connecting}
            onConnectGoogle={() => void connectGoogle()}
            onRecheck={refreshHealth}
          />
        )}
        {clash && (
          <p className="mx-2 rounded-lg border border-urgency-urgent/35 bg-black/50 px-3 py-2 text-[11.5px] leading-relaxed text-white/85">
            {clash.explanation}
          </p>
        )}
        {suggestions[0] && (
          <SuggestionCard
            suggestion={suggestions[0]}
            onAccept={acceptSuggestion}
            onDismiss={dismissSuggestion}
          />
        )}
        <TaskList
          tasks={tasks}
          now={now}
          maxVisible={maxVisible}
          onComplete={onComplete}
          onEdit={onEdit}
          onSnooze={onSnooze}
          onDelete={onDelete}
        />
      </div>
    </div>
  )
}
