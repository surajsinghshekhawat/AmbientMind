import type { TaskPriority } from './types'

export interface RecurrenceRule {
  id: string
  title: string
  /** 0 = Sunday, matching Date#getDay(). Sorted, unique. */
  weekdays: number[]
  /** Local wall-clock 'HH:MM'. */
  time: string
  priority: TaskPriority
  leadMinutes: number
  enabled: boolean
  createdAt: string
  source: 'explicit' | 'suggested'
}

export type NewRecurrenceRule = Omit<RecurrenceRule, 'id' | 'createdAt'> &
  Partial<Pick<RecurrenceRule, 'id' | 'createdAt'>>

const DAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday'
] as const

/** Longest first: "thurs" must not be consumed by "thu" leaving a stray "rs". */
const DAY_TOKENS: { pattern: string; day: number }[] = [
  { pattern: 'sundays', day: 0 },
  { pattern: 'sunday', day: 0 },
  { pattern: 'suns', day: 0 },
  { pattern: 'sun', day: 0 },
  { pattern: 'mondays', day: 1 },
  { pattern: 'monday', day: 1 },
  { pattern: 'mons', day: 1 },
  { pattern: 'mon', day: 1 },
  { pattern: 'tuesdays', day: 2 },
  { pattern: 'tuesday', day: 2 },
  { pattern: 'tues', day: 2 },
  { pattern: 'tue', day: 2 },
  { pattern: 'wednesdays', day: 3 },
  { pattern: 'wednesday', day: 3 },
  { pattern: 'weds', day: 3 },
  { pattern: 'wed', day: 3 },
  { pattern: 'thursdays', day: 4 },
  { pattern: 'thursday', day: 4 },
  { pattern: 'thurs', day: 4 },
  { pattern: 'thur', day: 4 },
  { pattern: 'thu', day: 4 },
  { pattern: 'fridays', day: 5 },
  { pattern: 'friday', day: 5 },
  { pattern: 'fri', day: 5 },
  { pattern: 'saturdays', day: 6 },
  { pattern: 'saturday', day: 6 },
  { pattern: 'sats', day: 6 },
  { pattern: 'sat', day: 6 }
]

export function weekdayLabel(day: number): string {
  return DAY_NAMES[day] ?? String(day)
}

export function describeRule(rule: Pick<RecurrenceRule, 'weekdays' | 'time'>): string {
  const days = [...rule.weekdays].sort((a, b) => a - b)
  if (days.length === 7) return `Every day at ${rule.time}`
  if (days.length === 5 && days.every((d) => d >= 1 && d <= 5)) {
    return `Weekdays at ${rule.time}`
  }
  const names = days.map((d) => weekdayLabel(d).slice(0, 3))
  return `${names.join(', ')} at ${rule.time}`
}

/**
 * Occurrences from `from` (exclusive of the past) up to `horizonDays` ahead.
 * Local time throughout: a 17:00 rule stays 17:00 across a DST change, which
 * is what "tuition at five" means to a person.
 */
export function occurrencesWithin(
  rule: Pick<RecurrenceRule, 'weekdays' | 'time'>,
  from: Date,
  horizonDays: number
): Date[] {
  const [hours, minutes] = rule.time.split(':').map(Number)
  if (hours === undefined || minutes === undefined) return []

  const days = new Set(rule.weekdays)
  const out: Date[] = []

  for (let offset = 0; offset <= horizonDays; offset++) {
    const day = new Date(from)
    day.setDate(from.getDate() + offset)
    if (!days.has(day.getDay())) continue
    day.setHours(hours, minutes, 0, 0)
    if (day.getTime() <= from.getTime()) continue
    out.push(day)
  }
  return out
}

/** Stable per rule and per date, so re-running materialisation cannot duplicate. */
export function occurrenceKey(ruleId: string, at: Date): string {
  const y = at.getFullYear()
  const m = String(at.getMonth() + 1).padStart(2, '0')
  const d = String(at.getDate()).padStart(2, '0')
  return `${ruleId}:${y}-${m}-${d}`
}

export interface ParsedRecurrence {
  title: string
  weekdays: number[]
  time: string
}

const FILLER = [
  'remind me to',
  'remind me for',
  'remind me about',
  'remind me',
  'remind',
  'add a',
  'add an',
  'add',
  'schedule',
  'i have'
]

/**
 * Same mapping the quick-add enrichment prompt uses, so "every evening" means
 * the same hour whether the model or this parser handled it.
 */
const NAMED_TIMES: { pattern: string; time: string; implies?: number[] }[] = [
  { pattern: 'midnight', time: '00:00' },
  { pattern: 'noon', time: '12:00' },
  // "every morning" is itself the recurrence: it needs no weekday list.
  { pattern: 'mornings', time: '09:00', implies: [0, 1, 2, 3, 4, 5, 6] },
  { pattern: 'morning', time: '09:00', implies: [0, 1, 2, 3, 4, 5, 6] },
  { pattern: 'afternoons', time: '14:00', implies: [0, 1, 2, 3, 4, 5, 6] },
  { pattern: 'afternoon', time: '14:00', implies: [0, 1, 2, 3, 4, 5, 6] },
  { pattern: 'evenings', time: '19:00', implies: [0, 1, 2, 3, 4, 5, 6] },
  { pattern: 'evening', time: '19:00', implies: [0, 1, 2, 3, 4, 5, 6] },
  { pattern: 'nights', time: '21:00', implies: [0, 1, 2, 3, 4, 5, 6] },
  { pattern: 'night', time: '21:00', implies: [0, 1, 2, 3, 4, 5, 6] }
]

function parseTime(text: string): { time: string; matched: string } | null {
  const twelve = text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/)
  if (twelve) {
    let hour = Number(twelve[1])
    const minute = Number(twelve[2] ?? 0)
    if (hour >= 1 && hour <= 12 && minute < 60) {
      if (twelve[3] === 'pm' && hour !== 12) hour += 12
      if (twelve[3] === 'am' && hour === 12) hour = 0
      return {
        time: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
        matched: twelve[0]
      }
    }
  }

  const twentyFour = text.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/)
  if (twentyFour) {
    return {
      time: `${String(Number(twentyFour[1])).padStart(2, '0')}:${twentyFour[2]}`,
      matched: twentyFour[0]
    }
  }
  return null
}

/**
 * Deterministic on purpose. A 3B model asked to parse "tue, thu, sat at 5pm"
 * is slower and less predictable than a regex, and a wrong recurrence is much
 * more annoying than a wrong one-off task: it repeats.
 *
 * Returns null unless the text is unambiguously recurring — either an explicit
 * marker ("every", "daily", "weekdays") or two or more distinct weekdays, which
 * a single-occurrence task almost never mentions.
 */
export function parseRecurrence(input: string): ParsedRecurrence | null {
  const text = input.toLowerCase().trim()
  if (!text) return null

  // A stated clock time always wins: "every morning at 6" means 06:00.
  const named = NAMED_TIMES.find(({ pattern }) => new RegExp(`\\b${pattern}\\b`).test(text))
  const parsedTime =
    parseTime(text) ?? (named ? { time: named.time, matched: named.pattern } : null)
  if (!parsedTime) return null

  const consumed: string[] = [parsedTime.matched]
  const days = new Set<number>()
  let explicitMarker = false

  if (/\bevery\s*day\b|\bdaily\b|\beveryday\b/.test(text)) {
    for (let d = 0; d < 7; d++) days.add(d)
    explicitMarker = true
    consumed.push('every day', 'everyday', 'daily')
  }
  if (/\bweekdays?\b/.test(text) && !/\bweekday\s+\w/.test(text)) {
    for (let d = 1; d <= 5; d++) days.add(d)
    explicitMarker = true
    consumed.push('weekdays', 'weekday')
  }
  if (/\bweekends?\b/.test(text)) {
    days.add(0)
    days.add(6)
    explicitMarker = true
    consumed.push('weekends', 'weekend')
  }
  if (/\b(every|each|weekly)\b/.test(text)) {
    explicitMarker = true
  }

  let remaining = text
  for (const { pattern, day } of DAY_TOKENS) {
    const re = new RegExp(`\\b${pattern}\\b`)
    if (re.test(remaining)) {
      days.add(day)
      remaining = remaining.replace(new RegExp(`\\b${pattern}\\b`, 'g'), ' ')
      consumed.push(pattern)
    }
  }

  // "every evening" carries the schedule as well as the hour — but only when no
  // weekday was named, so "every Tuesday evening" stays a single Tuesday.
  if (days.size === 0 && named?.implies) {
    for (const day of named.implies) days.add(day)
    explicitMarker = true
    consumed.push(named.pattern)
  }

  if (days.size === 0) return null
  if (!explicitMarker && days.size < 2) return null

  // "tuition Tuesday evening at 5pm" took its time from "5pm", but "evening"
  // is still schedule wording and does not belong in the title.
  if (named) consumed.push(named.pattern)

  let title = input.trim()
  for (const token of [...consumed, 'every', 'each', 'weekly', 'at', 'on', 'and', 'in the']) {
    title = title.replace(new RegExp(`\\b${token}\\b`, 'gi'), ' ')
  }
  title = title.replace(/[,;]+/g, ' ').replace(/\s+/g, ' ').trim()

  const lower = title.toLowerCase()
  for (const filler of FILLER) {
    if (lower.startsWith(filler)) {
      title = title.slice(filler.length).trim()
      break
    }
  }
  title = title.replace(/^[-:–]+/, '').replace(/\s+/g, ' ').trim()
  if (!title) return null

  return {
    title,
    weekdays: [...days].sort((a, b) => a - b),
    time: parsedTime.time
  }
}
