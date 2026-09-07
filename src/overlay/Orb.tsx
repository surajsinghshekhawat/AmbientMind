import type { Task, Urgency } from '@shared/types'
import { urgencyOf } from '@shared/urgency'
import { INTERACTIVE_ATTR } from './useMouseCapture'

const RING: Record<Urgency, string> = {
  neutral: 'border-white/30',
  approaching: 'border-urgency-approaching',
  urgent: 'border-urgency-urgent',
  overdue: 'border-urgency-overdue animate-overdue-pulse'
}

const GLOW: Record<Urgency, string> = {
  neutral: 'shadow-black/40',
  approaching: 'shadow-urgency-approaching/40',
  urgent: 'shadow-urgency-urgent/50',
  overdue: 'shadow-urgency-overdue/60'
}

/** The orb inherits the colour of whichever task is most pressing. */
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
  onExpand: () => void
}

export function Orb({ tasks, now, onExpand }: Props) {
  const pending = tasks.filter((task) => task.status === 'pending')
  const urgency = peakUrgency(pending, now)

  return (
    <div className="flex h-full w-full items-center justify-center">
      <button
        {...{ [INTERACTIVE_ATTR]: '' }}
        type="button"
        onClick={onExpand}
        aria-label={`AmbientMind: ${pending.length} pending task${pending.length === 1 ? '' : 's'}`}
        title={`${pending.length} pending`}
        className={`flex h-14 w-14 items-center justify-center rounded-full border-2 bg-black/55 shadow-lg backdrop-blur-md transition-all duration-200 hover:scale-105 hover:bg-black/75 ${RING[urgency]} ${GLOW[urgency]}`}
      >
        {pending.length > 0 ? (
          <span className="text-[17px] font-medium text-white/95 tabular-nums">
            {pending.length}
          </span>
        ) : (
          <span className="text-[15px] text-white/50">✓</span>
        )}
      </button>
    </div>
  )
}
