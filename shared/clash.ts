import type { Task } from './types'
import { hoursUntil } from './urgency'

/**
 * Two things landing at nearly the same time is the moment a task list stops
 * being useful and starts being stressful. The app can at least say which one
 * to do first, and why.
 *
 * The reasoning is deterministic rather than generated. An explanation that
 * changes wording or verdict between two identical runs is not advice, and a
 * 3B model cannot be relied on to order two items consistently.
 */

/** Deadlines closer together than this are treated as the same moment. */
const SIMULTANEOUS_MINUTES = 15
/** How far apart two deadlines can be and still compete for the same slot. */
const DEFAULT_WINDOW_MINUTES = 60
/** Clashes further out than this are not worth interrupting anyone about. */
const DEFAULT_HORIZON_HOURS = 36

const PRIORITY_RANK: Record<Task['priority'], number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3
}

export type ClashReason =
  | 'earlier-deadline'
  | 'higher-priority'
  | 'standing-commitment'
  | 'added-first'

export interface Clash {
  /** In the order they should be done. */
  order: Task[]
  reason: ClashReason
  explanation: string
}

function minutesApart(a: Task, b: Task): number {
  return Math.abs(Date.parse(a.deadline!) - Date.parse(b.deadline!)) / 60_000
}

function timeLabel(task: Task): string {
  return new Date(task.deadline!).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit'
  })
}

/** Which of two clashing tasks goes first, and on what grounds. */
function decide(a: Task, b: Task): { first: Task; second: Task; reason: ClashReason } {
  if (minutesApart(a, b) > SIMULTANEOUS_MINUTES) {
    const [first, second] =
      Date.parse(a.deadline!) <= Date.parse(b.deadline!) ? [a, b] : [b, a]
    return { first, second, reason: 'earlier-deadline' }
  }

  if (PRIORITY_RANK[a.priority] !== PRIORITY_RANK[b.priority]) {
    const [first, second] = PRIORITY_RANK[a.priority] < PRIORITY_RANK[b.priority] ? [a, b] : [b, a]
    return { first, second, reason: 'higher-priority' }
  }

  // A standing commitment has other people arranged around it; an ad-hoc task
  // at the same time and priority is the one with slack.
  if ((a.source === 'rule') !== (b.source === 'rule')) {
    const [first, second] = a.source === 'rule' ? [a, b] : [b, a]
    return { first, second, reason: 'standing-commitment' }
  }

  const [first, second] = a.createdAt <= b.createdAt ? [a, b] : [b, a]
  return { first, second, reason: 'added-first' }
}

function explain(first: Task, second: Task, reason: ClashReason): string {
  const firstTime = timeLabel(first)
  const secondTime = timeLabel(second)
  const collision = `"${first.title}" at ${firstTime} runs into "${second.title}" at ${secondTime}.`

  switch (reason) {
    case 'earlier-deadline':
      return `${collision} Do "${first.title}" first — it is due sooner.`
    case 'higher-priority':
      return `${collision} Do "${first.title}" first — it is ${first.priority}, the other is ${second.priority}.`
    case 'standing-commitment':
      return `${collision} Do "${first.title}" first — it is a standing commitment; the other can move.`
    case 'added-first':
      return `${collision} Nothing separates them, so do "${first.title}" first — you committed to it earlier.`
  }
}

export interface ClashOptions {
  windowMinutes?: number
  horizonHours?: number
  now?: number
}

/**
 * Pairs only. Three-way pile-ups are reported as the two tightest pairs rather
 * than one unreadable sentence.
 */
export function findClashes(tasks: Task[], options: ClashOptions = {}): Clash[] {
  const now = options.now ?? Date.now()
  const window = options.windowMinutes ?? DEFAULT_WINDOW_MINUTES
  const horizon = options.horizonHours ?? DEFAULT_HORIZON_HOURS

  const candidates = tasks
    .filter((task) => task.status === 'pending' && task.deadline)
    .filter((task) => {
      const hours = hoursUntil(task.deadline, now)
      return hours !== null && hours >= 0 && hours <= horizon
    })
    .sort((a, b) => Date.parse(a.deadline!) - Date.parse(b.deadline!))

  const clashes: Clash[] = []
  const paired = new Set<string>()

  for (let i = 0; i < candidates.length - 1; i++) {
    const a = candidates[i]!
    const b = candidates[i + 1]!
    if (paired.has(a.id) || paired.has(b.id)) continue
    if (minutesApart(a, b) > window) continue

    const { first, second, reason } = decide(a, b)
    paired.add(a.id)
    paired.add(b.id)
    clashes.push({
      order: [first, second],
      reason,
      explanation: explain(first, second, reason)
    })
  }

  return clashes
}
