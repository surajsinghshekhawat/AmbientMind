import { useCallback, useEffect, useState } from 'react'
import { orbLook, type Activity } from '@shared/orb'
import type { ShortcutStatus } from '@shared/shortcuts'
import type { HealthReport, RecurrenceSuggestion, Task } from '@shared/types'
import { DEFAULT_CONFIG } from '@shared/types'
import { Orb } from '@/ui/Orb'
import { ToastProvider } from '@/ui/Toast'
import { Panel } from './Panel'

const CLOCK_TICK_MS = 30_000
/** Collapsed, the orb only shows urgency by the hour and a count by the day. */
const COLLAPSED_CLOCK_TICK_MS = 60_000
/** Ollama gets started after the app often enough to be worth re-checking. */
const HEALTH_POLL_MS = 60_000
/** Collapsed, only the attention dot depends on it. */
const COLLAPSED_HEALTH_POLL_MS = 5 * 60_000

export function App() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [maxVisible, setMaxVisible] = useState(DEFAULT_CONFIG.maxTasksVisible)
  const [interval, setIntervalMinutes] = useState<number>(DEFAULT_CONFIG.syncIntervalMinutes)
  const [now, setNow] = useState(() => Date.now())
  const [expanded, setExpanded] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [reading, setReading] = useState(false)
  const [health, setHealth] = useState<HealthReport | null>(null)
  const [recurrence, setRecurrence] = useState<RecurrenceSuggestion[]>([])
  const [lastRun, setLastRun] = useState<string | null>(null)
  const [shortcuts, setShortcuts] = useState<ShortcutStatus[]>([])

  useEffect(() => {
    const apply = (config: typeof DEFAULT_CONFIG) => {
      setMaxVisible(config.maxTasksVisible)
      setIntervalMinutes(config.syncIntervalMinutes)
    }
    void window.ambient.getConfig().then(apply)
    void window.ambient.getShortcuts().then(setShortcuts)
    return window.ambient.onConfigChanged(apply)
  }, [])

  useEffect(() => {
    void window.ambient.getTasks().then(setTasks)
    return window.ambient.onTasksChanged(setTasks)
  }, [])

  const refreshHealth = useCallback(() => {
    void window.ambient.getHealth().then(setHealth)
  }, [])

  useEffect(
    () =>
      window.ambient.onSyncStatus((status) => {
        setSyncing(status.state === 'running')
        if (status.state !== 'idle') return
        void window.ambient.getSyncSummary().then((s) => setLastRun(s.lastRun))
        // A failed pass raises the dot now, not at the next poll.
        refreshHealth()
      }),
    [refreshHealth]
  )
  useEffect(() => window.ambient.onScreenStatus((status) => setReading(status.state === 'running')), [])
  useEffect(() => {
    void window.ambient.getSyncSummary().then((summary) => setLastRun(summary.lastRun))
  }, [])

  useEffect(() => {
    const off = window.ambient.onOverlayExpanded(setExpanded)
    // An expand sent before this listener existed would otherwise be lost.
    void window.ambient.getOverlayExpanded().then(setExpanded)
    return off
  }, [])

  useEffect(() => {
    refreshHealth()
    const id = setInterval(refreshHealth, expanded ? HEALTH_POLL_MS : COLLAPSED_HEALTH_POLL_MS)
    return () => clearInterval(id)
  }, [refreshHealth, expanded])

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), expanded ? CLOCK_TICK_MS : COLLAPSED_CLOCK_TICK_MS)
    return () => clearInterval(id)
  }, [expanded])

  // Only asked about while the panel is open; a pattern is never urgent.
  useEffect(() => {
    if (!expanded) return
    setNow(Date.now())
    void window.ambient.rules.suggestions().then(setRecurrence)
  }, [expanded])

  const connectGoogle = useCallback(async () => {
    try {
      await window.ambient.accounts.connect()
    } catch (err) {
      console.error(err)
    } finally {
      refreshHealth()
    }
  }, [refreshHealth])

  const activity: Activity = reading ? 'reading' : syncing ? 'syncing' : 'idle'

  if (!expanded) {
    const look = orbLook({ tasks, now, activity, attention: Boolean(health && !health.ok) })
    const label = ['AmbientMind', look.badge !== null && `${look.badge} due today`, look.attention && 'needs attention']
      .filter(Boolean)
      .join(', ')
    return (
      <div className="grid h-full w-full place-items-center">
        <button
          type="button"
          onClick={() => void window.ambient.setOverlayExpanded(true)}
          aria-label={`${label}: ${look.peek}`}
          title={look.peek}
          className="rounded-full outline-none transition-transform duration-300 ease-[var(--ease-spring)] hover:scale-[1.06] active:scale-95"
        >
          <Orb look={look} />
        </button>
      </div>
    )
  }

  return (
    <ToastProvider>
      <div className="p-px">
        <Panel
          tasks={tasks}
          now={now}
          activity={activity}
          health={health}
          recurrence={recurrence}
          lastRun={lastRun}
          syncIntervalMinutes={interval}
          maxVisible={maxVisible}
          shortcuts={shortcuts}
          onTasks={setTasks}
          onRecurrence={setRecurrence}
          onCollapse={() => void window.ambient.setOverlayExpanded(false)}
          onRecheckHealth={refreshHealth}
          onConnectGoogle={() => void connectGoogle()}
        />
      </div>
    </ToastProvider>
  )
}
