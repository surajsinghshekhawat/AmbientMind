import { useCallback, useEffect, useState } from 'react'
import type { OverlayCorner, Task } from '@shared/types'
import { DEFAULT_CONFIG } from '@shared/types'
import { Orb } from './Orb'
import { TaskList } from './TaskList'
import { INTERACTIVE_ATTR, useMouseCapture } from './useMouseCapture'

const CLOCK_TICK_MS = 30_000

export function App() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [maxVisible, setMaxVisible] = useState(DEFAULT_CONFIG.maxTasksVisible)
  const [corner, setCorner] = useState<OverlayCorner>(DEFAULT_CONFIG.overlayCorner)
  const [now, setNow] = useState(() => Date.now())
  const [expanded, setExpanded] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [googleConnected, setGoogleConnected] = useState<boolean | null>(null)
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

  useEffect(() => {
    void window.ambient.accounts.status().then((s) => setGoogleConnected(s.google))
  }, [])

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

  const connectGoogle = useCallback(async () => {
    setConnecting(true)
    try {
      await window.ambient.accounts.connect()
      const status = await window.ambient.accounts.status()
      setGoogleConnected(status.google)
    } catch (err) {
      console.error(err)
    } finally {
      setConnecting(false)
    }
  }, [])

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
        {googleConnected === false && (
          <button
            type="button"
            onClick={() => void connectGoogle()}
            disabled={connecting}
            className="mx-2 rounded-lg border border-white/15 bg-white/10 px-3 py-2 text-left text-[12px] text-white/80 hover:bg-white/15 disabled:opacity-50"
          >
            {connecting ? 'Opening Google sign-in…' : 'Connect Google to fill this list from mail'}
          </button>
        )}
        <TaskList tasks={tasks} now={now} maxVisible={maxVisible} onComplete={onComplete} />
      </div>
    </div>
  )
}
