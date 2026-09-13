import { useMemo, useState } from 'react'
import type { Task } from '@shared/types'
import { sortByUrgency } from '@shared/urgency'
import { TaskItem } from './TaskItem'

interface Props {
  tasks: Task[]
  now: number
  maxVisible: number
  onComplete: (id: string) => void
  onEdit: (id: string, title: string) => void
  onSnooze: (id: string, until: string) => void
  onDelete: (id: string) => void
}

/**
 * Urgency still wins, but a task you just added must never vanish behind the
 * max-visible cut — that was the "I added it and it disappeared" bug.
 */
function visibleTasks(tasks: Task[], now: number, maxVisible: number): Task[] {
  const ranked = sortByUrgency(tasks, now)
  if (ranked.length <= maxVisible) return ranked

  const newest = [...tasks].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
  const head = ranked.slice(0, maxVisible)
  if (!newest || head.some((task) => task.id === newest.id)) return head

  return [...head.slice(0, maxVisible - 1), newest]
}

export function TaskList({
  tasks,
  now,
  maxVisible,
  onComplete,
  onEdit,
  onSnooze,
  onDelete
}: Props) {
  const [showAll, setShowAll] = useState(false)

  const pending = useMemo(() => tasks.filter((task) => task.status === 'pending'), [tasks])
  const visible = useMemo(
    () => (showAll ? sortByUrgency(pending, now) : visibleTasks(pending, now, maxVisible)),
    [pending, now, maxVisible, showAll]
  )
  const hidden = Math.max(0, pending.length - visible.length)

  if (pending.length === 0) {
    return <p className="px-3 text-[12px] text-white/40">Nothing pending. Enjoy it.</p>
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1.5">
      <ul className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto pr-1">
        {visible.map((task) => (
          <TaskItem
            key={task.id}
            task={task}
            now={now}
            onComplete={onComplete}
            onEdit={onEdit}
            onSnooze={onSnooze}
            onDelete={onDelete}
          />
        ))}
      </ul>
      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="px-3 text-left text-[10px] text-white/40 hover:text-white/70"
        >
          +{hidden} more · show all
        </button>
      )}
      {showAll && pending.length > maxVisible && (
        <button
          type="button"
          onClick={() => setShowAll(false)}
          className="px-3 text-left text-[10px] text-white/40 hover:text-white/70"
        >
          Show top {maxVisible} only
        </button>
      )}
    </div>
  )
}
