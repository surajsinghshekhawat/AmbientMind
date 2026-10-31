import { bucketFor } from './evidence'
import type { Task, TaskSource } from './types'
import { isDueToday, sortByUrgency } from './urgency'

export interface PanelSections {
  /** Overdue and due today. */
  now: Task[]
  /** Found by the model, waiting for a yes. */
  suggested: Task[]
  /** Meetings to prepare for that are not due today. */
  upcoming: Task[]
  later: Task[]
  doneToday: Task[]
  snoozed: Task[]
}

export function matchesQuery(task: Task, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  return [task.title, task.rawContext ?? '', task.evidence ?? '', ...task.people].some((text) =>
    text.toLowerCase().includes(needle)
  )
}

function startOfDay(now: number): number {
  return new Date(now).setHours(0, 0, 0, 0)
}

export function panelSections(tasks: Task[], now: number, query = ''): PanelSections {
  const shown = tasks.filter((task) => matchesQuery(task, query))
  const open = sortByUrgency(
    shown.filter((task) => task.status === 'pending'),
    now
  )
  const dueNow = open.filter((task) => isDueToday(task, now))
  const rest = open.filter((task) => !isDueToday(task, now))
  const dayStart = startOfDay(now)

  return {
    now: dueNow,
    suggested: sortByUrgency(
      shown.filter((task) => task.status === 'suggested'),
      now
    ),
    upcoming: rest.filter((task) => isMeeting(task.source)),
    later: rest.filter((task) => !isMeeting(task.source)),
    doneToday: shown
      .filter((task) => task.status === 'done' && task.completedAt && Date.parse(task.completedAt) >= dayStart)
      .sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? '')),
    snoozed: shown
      .filter((task) => task.status === 'snoozed')
      .sort((a, b) => (a.snoozedUntil ?? '').localeCompare(b.snoozedUntil ?? ''))
  }
}

/**
 * Said when there is nothing open, so an empty panel reads as "done", not as
 * "broken". The next check is the last run plus the interval.
 */
export function allClearLine(lastRun: string | null, intervalMinutes: number, now: number): string {
  if (!lastRun) return 'All clear.'
  const next = Date.parse(lastRun) + intervalMinutes * 60_000
  if (Number.isNaN(next)) return 'All clear.'
  const minutes = Math.round((next - now) / 60_000)
  if (minutes <= 1) return 'All clear. Checking again shortly.'
  return `All clear. Next check in ${minutes} min.`
}

/** Confidence in words; a percentage claims a precision the model does not have. */
/** Stored confidence already reflects whether the quote was the model's own; see parseExtraction. */
export function confidenceLabel(confidence: number): 'High' | 'Medium' | 'Low' {
  const bucket = bucketFor(confidence, true)
  return bucket === 'high' ? 'High' : bucket === 'medium' ? 'Medium' : 'Low'
}

export function isMeeting(source: TaskSource): boolean {
  return source === 'gcalendar' || source === 'acalendar'
}

export const SOURCE_LABEL: Record<TaskSource, string> = {
  gmail: 'Gmail',
  gcalendar: 'Calendar',
  acalendar: 'Calendar',
  reminders: 'Reminders',
  outlook: 'Outlook',
  teams: 'Teams',
  voice: 'Voice',
  manual: 'Added by you',
  rule: 'Recurring'
}

export function openSourceLabel(source: TaskSource): string | null {
  if (source === 'gmail') return 'Open in Gmail'
  if (source === 'gcalendar') return 'Open in Calendar'
  if (source === 'outlook') return 'Open in Outlook'
  if (source === 'teams') return 'Open in Teams'
  return null
}
