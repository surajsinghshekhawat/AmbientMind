import { useMemo } from 'react'
import type { Task } from '@shared/types'
import { sortByUrgency } from '@shared/urgency'
import { TaskItem } from './TaskItem'

interface Props {
  tasks: Task[]
  now: number
  maxVisible: number
  onComplete: (id: string) => void
}

/**
 * Urgency still wins, but a task you just added must never vanish behind the
 * max-visible cut — that was the "I added it and it disappeared" bug.
 */
function visibleTasks(tasks: Task[], now: number, maxVisible: number): Task[] {
  const pending = tasks.filter((task) => task.status === 'pending')
  const ranked = sortByUrgency(pending, now)
  if (ranked.length <= maxVisible) return ranked

  const newest = [...pending].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
  const head = ranked.slice(0, maxVisible)
  if (!newest || head.some((task) => task.id === newest.id)) return head

  return [...head.slice(0, maxVisible - 1), newest]
}

export function TaskList({ tasks, now, maxVisible, onComplete }: Props) {
  const pendingCount = useMemo(
    () => tasks.filter((task) => task.status === 'pending').length,
    [tasks]
  )
  const visible = useMemo(
    () => visibleTasks(tasks, now, maxVisible),
    [tasks, now, maxVisible]
  )
  const hidden = Math.max(0, pendingCount - visible.length)

  if (visible.length === 0) {
    return <p className="px-3 text-[12px] text-white/40">Nothing pending. Enjoy it.</p>
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1.5">
      <ul className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto pr-1">
        {visible.map((task) => (
          <TaskItem key={task.id} task={task} now={now} onComplete={onComplete} />
        ))}
      </ul>
      {hidden > 0 && (
        <p className="px-3 text-[10px] text-white/30">
          +{hidden} more not shown (lower urgency)
        </p>
      )}
    </div>
  )
}
