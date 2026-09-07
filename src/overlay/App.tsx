import { useCallback, useEffect, useState } from 'react'
import type { Task } from '@shared/types'
import { DEFAULT_CONFIG } from '@shared/types'
import { TaskList } from './TaskList'
import { useMouseCapture } from './useMouseCapture'

const CLOCK_TICK_MS = 30_000

export function App() {
  const [tasks, setTasks] = useState<Task[]>([])
  // Urgency is derived from wall-clock time, so the tree needs a periodic nudge
  // to re-colour and re-sort without any data actually changing.
  const [now, setNow] = useState(() => Date.now())

  useMouseCapture()

  useEffect(() => {
    void window.ambient.getTasks().then(setTasks)
    return window.ambient.onTasksChanged(setTasks)
  }, [])

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), CLOCK_TICK_MS)
    return () => clearInterval(id)
  }, [])

  const onComplete = useCallback((id: string) => {
    void window.ambient.completeTask(id).then(setTasks)
  }, [])

  return (
    <div className="flex h-full flex-col gap-2 p-1">
      <header className="px-3 text-[10px] font-medium tracking-[0.18em] text-white/35 uppercase">
        AmbientMind
      </header>
      <TaskList
        tasks={tasks}
        now={now}
        maxVisible={DEFAULT_CONFIG.maxTasksVisible}
        onComplete={onComplete}
      />
    </div>
  )
}
