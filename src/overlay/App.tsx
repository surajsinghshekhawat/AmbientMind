import { useCallback, useEffect, useState } from 'react'
import type { Task } from '@shared/types'
import { DEFAULT_CONFIG } from '@shared/types'
import { Orb } from './Orb'
import { TaskList } from './TaskList'
import { INTERACTIVE_ATTR, useMouseCapture } from './useMouseCapture'

const CLOCK_TICK_MS = 30_000

export function App() {
  const [tasks, setTasks] = useState<Task[]>([])
  // Urgency is derived from wall-clock time, so the tree needs a periodic nudge
  // to re-colour and re-sort without any data actually changing.
  const [now, setNow] = useState(() => Date.now())
  // Collapsed by default: ambient presence first, detail on demand.
  const [expanded, setExpanded] = useState(false)
  const [syncing, setSyncing] = useState(false)

  useMouseCapture()

  useEffect(() => {
    void window.ambient.getTasks().then(setTasks)
    return window.ambient.onTasksChanged((next) => {
      setTasks((prev) => {
        const prevPending = prev.filter((task) => task.status === 'pending').length
        const nextPending = next.filter((task) => task.status === 'pending').length
        // Opening QuickAdd collapses attention onto typing; expand so the new
        // row is actually visible instead of only bumping the orb count.
        if (nextPending > prevPending) {
          setExpanded(true)
          window.ambient.setOverlayExpanded(true)
        }
        return next
      })
    })
  }, [])

  useEffect(() => window.ambient.onSyncStatus((s) => setSyncing(s.state === 'running')), [])

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), CLOCK_TICK_MS)
    return () => clearInterval(id)
  }, [])

  const toggle = useCallback((next: boolean) => {
    setExpanded(next)
    window.ambient.setOverlayExpanded(next)
  }, [])

  const onComplete = useCallback((id: string) => {
    void window.ambient.completeTask(id).then(setTasks)
  }, [])

  if (!expanded) {
    return <Orb tasks={tasks} now={now} onExpand={() => toggle(true)} />
  }

  return (
    <div className="flex h-full flex-col gap-2 p-1">
      <button
        {...{ [INTERACTIVE_ATTR]: '' }}
        type="button"
        onClick={() => toggle(false)}
        className="flex items-center gap-2 px-3 py-1 text-left text-[10px] font-medium tracking-[0.18em] text-white/35 uppercase transition-colors hover:text-white/70"
      >
        AmbientMind
        {syncing && <span className="text-urgency-approaching normal-case">· syncing</span>}
        <span className="ml-auto text-[13px] tracking-normal normal-case">×</span>
      </button>
      <TaskList
        tasks={tasks}
        now={now}
        maxVisible={DEFAULT_CONFIG.maxTasksVisible}
        onComplete={onComplete}
      />
    </div>
  )
}
