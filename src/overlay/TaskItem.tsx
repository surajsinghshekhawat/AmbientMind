import type { Task, Urgency } from '@shared/types'
import { formatDeadline, urgencyOf } from '@shared/urgency'
import { INTERACTIVE_ATTR } from './useMouseCapture'

const ACCENT: Record<Urgency, string> = {
  neutral: 'text-urgency-neutral/60',
  approaching: 'text-urgency-approaching',
  urgent: 'text-urgency-urgent',
  overdue: 'text-urgency-overdue'
}

const BAR: Record<Urgency, string> = {
  neutral: 'bg-white/25',
  approaching: 'bg-urgency-approaching',
  urgent: 'bg-urgency-urgent',
  overdue: 'bg-urgency-overdue animate-overdue-pulse'
}

interface Props {
  task: Task
  now: number
  onComplete: (id: string) => void
}

export function TaskItem({ task, now, onComplete }: Props) {
  const urgency = urgencyOf(task, now)
  const done = task.status === 'done'

  return (
    <li
      {...{ [INTERACTIVE_ATTR]: '' }}
      className={`group flex items-start gap-3 rounded-xl border border-white/10 bg-black/35 px-3 py-2.5 backdrop-blur-md transition-all duration-200 hover:border-white/25 hover:bg-black/55 ${
        done ? 'opacity-40' : ''
      }`}
    >
      <span className={`mt-1.5 h-6 w-0.5 shrink-0 rounded-full ${BAR[urgency]}`} />

      <button
        type="button"
        onClick={() => onComplete(task.id)}
        aria-label={done ? 'Completed' : `Complete: ${task.title}`}
        className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-white/35 text-[9px] leading-none text-white/90 transition-colors hover:border-white hover:bg-white/20"
      >
        {done ? '✓' : ''}
      </button>

      <div className="min-w-0 flex-1">
        <p
          className={`truncate text-[13px] leading-snug text-white/95 ${
            done ? 'line-through' : ''
          }`}
          title={task.title}
        >
          {task.title}
        </p>
        <p className={`mt-0.5 text-[10.5px] tracking-wide ${ACCENT[urgency]}`}>
          {formatDeadline(task.deadline, now)}
          <span className="text-white/30"> · {task.source}</span>
        </p>
      </div>
    </li>
  )
}
