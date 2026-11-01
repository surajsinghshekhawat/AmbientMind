/** How far ahead of a deadline the notification goes out; null is off. */
export const REMIND_CHOICES = [
  { minutes: null, label: 'Off' },
  { minutes: 0, label: 'At the deadline' },
  { minutes: 5, label: '5 minutes before' },
  { minutes: 15, label: '15 minutes before' },
  { minutes: 30, label: '30 minutes before' },
  { minutes: 60, label: '1 hour before' }
] as const

export type RemindBefore = (typeof REMIND_CHOICES)[number]['minutes']

export function isRemindBefore(value: unknown): value is RemindBefore {
  return REMIND_CHOICES.some((choice) => choice.minutes === value)
}

/**
 * Past this, a missed deadline isn't announced: opening the laptop in the
 * morning shouldn't bring a stack of yesterday's alerts.
 */
export const ALERT_GRACE_MINUTES = 60
/** More than this at once is a flood, not a reminder; the rest wait a sweep. */
export const MAX_ALERTS_AT_ONCE = 3

export interface AlertCandidate {
  deadline: string | null
  remindedAt: string | null
  remindAt: string | null
}

export function shouldAlert(task: AlertCandidate, now: number, leadMinutes: number): boolean {
  if (task.remindAt) return Date.parse(task.remindAt) <= now
  if (task.remindedAt || !task.deadline) return false
  const due = Date.parse(task.deadline)
  if (!Number.isFinite(due)) return false
  return due - leadMinutes * 60_000 <= now && now <= due + ALERT_GRACE_MINUTES * 60_000
}

function span(minutes: number): string {
  if (minutes < 60) return `${minutes} min`
  const hours = Math.round(minutes / 60)
  return `${hours} hour${hours === 1 ? '' : 's'}`
}

/** "Due in 15 min", "Due now", "Was due 20 min ago". */
export function alertBody(deadline: string, now: number): string {
  const minutes = Math.round((Date.parse(deadline) - now) / 60_000)
  if (minutes >= 1) return `Due in ${span(minutes)}`
  if (minutes > -1) return 'Due now'
  return `Was due ${span(-minutes)} ago`
}
