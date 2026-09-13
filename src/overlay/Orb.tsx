import type { Task, Urgency } from '@shared/types'
import { urgencyOf } from '@shared/urgency'
import { INTERACTIVE_ATTR } from './useMouseCapture'

const RING: Record<Urgency, string> = {
  neutral: '#d0d4dc',
  approaching: '#f5c26b',
  urgent: '#ff8a65',
  overdue: '#ff5c5c'
}

function peakUrgency(tasks: Task[], now: number): Urgency {
  const order: Urgency[] = ['neutral', 'approaching', 'urgent', 'overdue']
  return tasks.reduce<Urgency>((peak, task) => {
    const current = urgencyOf(task, now)
    return order.indexOf(current) > order.indexOf(peak) ? current : peak
  }, 'neutral')
}

interface Props {
  tasks: Task[]
  now: number
  expanded: boolean
  onToggle: () => void
}

/** Fills the collapsed window. No outer shadow — that painted a square halo. */
export function Orb({ tasks, now, expanded, onToggle }: Props) {
  const pending = tasks.filter((task) => task.status === 'pending')
  const urgency = peakUrgency(pending, now)
  const ring = RING[urgency]

  return (
    <button
      {...{ [INTERACTIVE_ATTR]: '' }}
      type="button"
      onClick={onToggle}
      aria-label={expanded ? 'Minimize AmbientMind' : `Show ${pending.length} tasks`}
      title={expanded ? 'Minimize' : 'Show tasks'}
      className={`block h-[70px] w-[70px] shrink-0 cursor-pointer rounded-full border-0 p-0 ${
        urgency === 'overdue' ? 'animate-overdue-pulse' : ''
      }`}
      style={{
        background: `radial-gradient(circle at 32% 28%, #4a4a52 0%, #1c1c20 48%, #0c0c0e 100%) padding-box, ${ring} border-box`,
        border: `3px solid ${ring}`,
        boxShadow: 'none',
        color: '#f4f4f5'
      }}
    >
      <span className="flex h-full w-full items-center justify-center text-[22px] font-semibold tabular-nums leading-none">
        {pending.length}
      </span>
    </button>
  )
}
