/**
 * Finds commitments that look weekly from what has actually happened, so the
 * app can *ask* whether to make them a rule. Deliberately not a model and not
 * a learner: with a handful of rows a threshold is more predictable, and the
 * cost of a wrong guess is a task that repeats forever.
 */

export interface ObservedTask {
  title: string
  /** When it was due, or when it was added if it never had a deadline. */
  at: string
}

export interface DetectedRecurrence {
  /** Stable identity of the pattern, so a dismissal can be remembered. */
  signature: string
  title: string
  weekdays: number[]
  time: string
  occurrences: number
}

export interface DetectOptions {
  /** Distinct weeks the pattern must appear in before it is worth asking. */
  minWeeks?: number
  /** How far back to look. */
  windowDays?: number
  /** Spread allowed between the earliest and latest time of day, in minutes. */
  toleranceMinutes?: number
  now?: Date
}

const DEFAULTS = {
  minWeeks: 3,
  windowDays: 35,
  toleranceMinutes: 90
}

export function normaliseTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** ISO-ish week key. Only used to tell repeats apart from one busy week. */
function weekKey(date: Date): string {
  const monday = new Date(date)
  const shift = (date.getDay() + 6) % 7
  monday.setDate(date.getDate() - shift)
  monday.setHours(0, 0, 0, 0)
  return `${monday.getFullYear()}-${monday.getMonth() + 1}-${monday.getDate()}`
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? Math.round(((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2)
    : (sorted[middle] ?? 0)
}

function formatMinutes(minutesOfDay: number): string {
  // Rounded to a quarter hour: nobody means 17:07 when they say "after school".
  const rounded = Math.round(minutesOfDay / 15) * 15
  const hours = Math.floor(rounded / 60) % 24
  const minutes = rounded % 60
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

export function detectRecurrences(
  tasks: ObservedTask[],
  options: DetectOptions = {}
): DetectedRecurrence[] {
  const config = { ...DEFAULTS, ...options }
  const now = options.now ?? new Date()
  const cutoff = now.getTime() - config.windowDays * 86_400_000

  const groups = new Map<
    string,
    { title: string; weekday: number; minutes: number[]; weeks: Set<string> }
  >()

  for (const task of tasks) {
    const at = new Date(task.at)
    if (Number.isNaN(at.getTime()) || at.getTime() < cutoff) continue

    const title = normaliseTitle(task.title)
    if (!title) continue

    const key = `${title}|${at.getDay()}`
    const group = groups.get(key) ?? {
      title: task.title.trim(),
      weekday: at.getDay(),
      minutes: [],
      weeks: new Set<string>()
    }
    group.minutes.push(at.getHours() * 60 + at.getMinutes())
    group.weeks.add(weekKey(at))
    groups.set(key, group)
  }

  const detected: DetectedRecurrence[] = []
  for (const [key, group] of groups) {
    if (group.weeks.size < config.minWeeks) continue

    const spread = Math.max(...group.minutes) - Math.min(...group.minutes)
    // Same weekday at wildly different times is a coincidence, not a routine.
    if (spread > config.toleranceMinutes) continue

    detected.push({
      signature: key,
      title: group.title,
      weekdays: [group.weekday],
      time: formatMinutes(median(group.minutes)),
      occurrences: group.minutes.length
    })
  }

  return detected.sort((a, b) => b.occurrences - a.occurrences)
}
