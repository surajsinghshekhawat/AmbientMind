/**
 * Finds commitments that look weekly from what has actually happened, so the
 * app can *ask* whether to make them a rule. Deliberately not a model and not
 * a learner: with a handful of rows a threshold is more predictable, and the
 * cost of a wrong guess is a task that repeats forever.
 */

import { similarity } from './similarity'

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
  /** How alike two titles must be to count as the same habit. */
  titleThreshold?: number
  now?: Date
}

const DEFAULTS = {
  minWeeks: 3,
  windowDays: 35,
  toleranceMinutes: 90,
  // Same threshold the cross-source deduplicator uses, for the same reason.
  titleThreshold: 0.72
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

/**
 * Whether two normalised titles describe the same commitment.
 *
 * Dice similarity alone is not enough: "tuition" against "tuition class"
 * scores 0.67, under the 0.72 the deduplicator uses, so the two halves were
 * counted separately and neither reached the three-week threshold. Writing the
 * same thing at two lengths is the common case, so a word-set subset counts as
 * a match too.
 *
 * The threshold can be looser here than in deduplication because the stakes
 * are not symmetric. Merging two habits wrongly produces one question the user
 * can decline; splitting one habit wrongly produces silence, and the feature
 * simply never fires.
 */
function sameHabit(a: string, b: string, threshold: number): boolean {
  if (a === b) return true
  if (similarity(a, b) >= threshold) return true

  const wordsA = new Set(a.split(' '))
  const wordsB = new Set(b.split(' '))
  const [shorter, longer] = wordsA.size <= wordsB.size ? [wordsA, wordsB] : [wordsB, wordsA]

  // Guards against "call" swallowing "call mom": a one-word stub has to be a
  // real word, not a fragment.
  const shortestWord = [...shorter].reduce((min, word) => Math.min(min, word.length), Infinity)
  if (shortestWord < 4) return false

  return [...shorter].every((word) => longer.has(word))
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

  // Sorted so clustering is independent of the order rows arrive in: the same
  // history must always produce the same signature, or a dismissal stops
  // matching and the same question comes back.
  const entries = tasks
    .map((task) => ({ task, at: new Date(task.at), title: normaliseTitle(task.title) }))
    .filter(({ at, title }) => !Number.isNaN(at.getTime()) && at.getTime() >= cutoff && title)
    .sort((a, b) => a.title.localeCompare(b.title) || a.at.getTime() - b.at.getTime())

  interface Group {
    /** Lexicographically first normalised title; the stable cluster identity. */
    key: string
    title: string
    weekday: number
    minutes: number[]
    weeks: Set<string>
  }

  const groups: Group[] = []
  for (const { task, at, title } of entries) {
    const weekday = at.getDay()
    // "Tuition" and "Tuition class" are one habit. Exact matching split them
    // and neither half ever reached the three-week threshold.
    const group = groups.find(
      (candidate) =>
        candidate.weekday === weekday && sameHabit(candidate.key, title, config.titleThreshold)
    )

    if (group) {
      group.minutes.push(at.getHours() * 60 + at.getMinutes())
      group.weeks.add(weekKey(at))
      continue
    }

    groups.push({
      key: title,
      title: task.title.trim(),
      weekday,
      minutes: [at.getHours() * 60 + at.getMinutes()],
      weeks: new Set([weekKey(at)])
    })
  }

  const detected: DetectedRecurrence[] = []
  for (const group of groups) {
    const key = `${group.key}|${group.weekday}`
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
