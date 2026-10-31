import type { Task, Urgency } from './types'
import { formatDeadline, isDueToday, sortByUrgency, urgencyOf } from './urgency'

/** What the app is doing right now, as far as the orb is concerned. */
export type Activity = 'idle' | 'syncing' | 'extracting' | 'reading' | 'listening' | 'composing'

/** The `thinking-orbs` animations the orb uses. */
export type OrbMotion = 'breathing' | 'connecting' | 'weaving' | 'searching' | 'listening' | 'composing'

export interface OrbLook {
  motion: OrbMotion
  /** Idle runs slow and dim so the orb never competes with real work. */
  calm: boolean
  /** Thin ring around the orb for the most pressing open task. */
  arc: Exclude<Urgency, 'neutral'> | null
  /** Overdue plus due today; never the total. */
  badge: number | null
  /** Something needs the user (a permission, a missing model): a dot, not motion. */
  attention: boolean
  /** One line for the tooltip and screen readers. */
  peek: string
}

const MOTION: Record<Activity, OrbMotion> = {
  idle: 'breathing',
  syncing: 'connecting',
  extracting: 'weaving',
  reading: 'searching',
  listening: 'listening',
  composing: 'composing'
}

export const ACTIVITY_LINE: Record<Exclude<Activity, 'idle'>, string> = {
  syncing: 'Checking mail and calendar…',
  extracting: 'Finding tasks…',
  reading: 'Reading your screen…',
  listening: 'Listening…',
  composing: 'Thinking…'
}

const SEVERITY: Urgency[] = ['overdue', 'urgent', 'approaching']

export function orbLook(input: {
  tasks: Task[]
  now: number
  activity: Activity
  attention: boolean
}): OrbLook {
  const { tasks, now, activity, attention } = input
  const open = tasks.filter((task) => task.status === 'pending')
  const urgencies = new Set(open.map((task) => urgencyOf(task, now)))
  const arc = SEVERITY.find((level) => urgencies.has(level)) ?? null
  const due = open.filter((task) => isDueToday(task, now)).length
  const next = sortByUrgency(open, now)[0]

  let peek = 'Nothing due'
  if (activity !== 'idle') peek = ACTIVITY_LINE[activity]
  else if (next) peek = next.deadline ? `${next.title} · ${formatDeadline(next.deadline, now)}` : next.title

  return {
    motion: MOTION[activity],
    calm: activity === 'idle',
    arc: arc === 'neutral' ? null : arc,
    badge: due > 0 ? due : null,
    attention,
    peek
  }
}
