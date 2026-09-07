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

export function TaskList({ tasks, now, maxVisible, onComplete }: Props) {
  const visible = useMemo(
    () => sortByUrgency(tasks.filter((task) => task.status === 'pending'), now).slice(0, maxVisible),
    [tasks, now, maxVisible]
  )

  if (visible.length === 0) {
    return <p className="px-3 text-[12px] text-white/40">Nothing pending. Enjoy it.</p>
  }

  return (
    <ul className="flex flex-col gap-1.5">
      {visible.map((task) => (
        <TaskItem key={task.id} task={task} now={now} onComplete={onComplete} />
      ))}
    </ul>
  )
}
