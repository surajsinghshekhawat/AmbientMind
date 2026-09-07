import type { Task, TaskPriority, Urgency } from './types'

const HOUR = 3_600_000
const IMMINENT_HOURS = 2

const PRIORITY_RANK: Record<TaskPriority, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3
}

export function hoursUntil(deadline: string | null, now = Date.now()): number | null {
  if (!deadline) return null
  const at = Date.parse(deadline)
  return Number.isNaN(at) ? null : (at - now) / HOUR
}

export function urgencyOf(task: Task, now = Date.now()): Urgency {
  const hours = hoursUntil(task.deadline, now)
  if (hours === null) return 'neutral'
  if (hours < 0) return 'overdue'
  if (hours < 24) return 'urgent'
  if (hours < 72) return 'approaching'
  return 'neutral'
}

export function isImminent(task: Task, now = Date.now()): boolean {
  const hours = hoursUntil(task.deadline, now)
  return hours !== null && hours < IMMINENT_HOURS
}

/**
 * Anything due inside two hours is pulled to the top regardless of priority;
 * everything below that is ordered by deadline, then by priority, so undated
 * tasks sink but stay visible.
 */
export function sortByUrgency(tasks: Task[], now = Date.now()): Task[] {
  return [...tasks].sort((a, b) => {
    const imminent = Number(isImminent(b, now)) - Number(isImminent(a, now))
    if (imminent !== 0) return imminent

    const ha = hoursUntil(a.deadline, now)
    const hb = hoursUntil(b.deadline, now)
    if (ha !== null && hb !== null && ha !== hb) return ha - hb
    if (ha !== null && hb === null) return -1
    if (ha === null && hb !== null) return 1

    return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]
  })
}

export function formatDeadline(deadline: string | null, now = Date.now()): string {
  const hours = hoursUntil(deadline, now)
  if (hours === null) return 'no deadline'

  if (hours < 0) {
    const overdue = Math.abs(hours)
    if (overdue < 24) return `${Math.max(1, Math.round(overdue))}h overdue`
    return `${Math.round(overdue / 24)}d overdue`
  }
  if (hours < 1) return `in ${Math.max(1, Math.round(hours * 60))}m`
  if (hours < 24) return `in ${Math.round(hours)}h`
  if (hours < 48) return 'tomorrow'
  return `in ${Math.round(hours / 24)}d`
}
