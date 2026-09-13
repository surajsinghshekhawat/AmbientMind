import { useState } from 'react'
import type { Task, TaskSource, Urgency } from '@shared/types'
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

const SOURCE_LABEL: Record<TaskSource, string> = {
  gmail: 'Gmail',
  gcalendar: 'Calendar',
  outlook: 'Outlook',
  teams: 'Teams',
  voice: 'Voice',
  manual: 'Manual'
}

interface Props {
  task: Task
  now: number
  onComplete: (id: string) => void
}

function formatWhen(iso: string | null): string {
  if (!iso) return 'none'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit'
  })
}

export function TaskItem({ task, now, onComplete }: Props) {
  const urgency = urgencyOf(task, now)
  const done = task.status === 'done'
  const [open, setOpen] = useState(false)
  const from = task.people[0]

  return (
    <li
      {...{ [INTERACTIVE_ATTR]: '' }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
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
          className={`text-[13px] leading-snug text-white/95 ${open ? 'whitespace-pre-wrap break-words' : 'line-clamp-2'} ${
            done ? 'line-through' : ''
          }`}
        >
          {task.title}
        </p>
        <p className={`mt-0.5 text-[10.5px] tracking-wide ${ACCENT[urgency]}`}>
          {formatDeadline(task.deadline, now)}
          <span className="text-white/30"> · {SOURCE_LABEL[task.source]}</span>
        </p>
        {open && (
          <div className="mt-2 space-y-1 border-t border-white/10 pt-2 text-[11px] leading-relaxed text-white/70">
            {from && (task.source === 'gmail' || task.source === 'gcalendar') && (
              <p>
                From <span className="text-white/90">{from}</span>
                {task.people.length > 1 ? ` · ${task.people.slice(1).join(', ')}` : ''}
              </p>
            )}
            <p>Added {formatWhen(task.createdAt)}</p>
            <p>Deadline {formatWhen(task.deadline)}</p>
            {task.rawContext && (
              <p className="whitespace-pre-wrap break-words text-white/55">
                {task.rawContext.length > 360 ? `${task.rawContext.slice(0, 360)}…` : task.rawContext}
              </p>
            )}
          </div>
        )}
      </div>
    </li>
  )
}
