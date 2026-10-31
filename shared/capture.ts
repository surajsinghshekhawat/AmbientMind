import { parseRecurrence, type ParsedRecurrence } from './recurrence'
import type { TaskPriority } from './types'
import { isScreenCaptureIntent } from './voiceIntent'

/**
 * What a typed or spoken capture says, read deterministically. Quick Capture
 * shows it as chips while you type and the main process saves exactly this,
 * so the chips never promise something the save does not do. The model may
 * still tidy the title afterwards, but it never overrides these fields.
 */
export interface ParsedCapture {
  title: string
  deadline: string | null
  /** Words for the date chip, e.g. "Tomorrow, 5:00 pm". */
  deadlineLabel: string | null
  priority: TaskPriority | null
  people: string[]
  recurrence: ParsedRecurrence | null
  screen: boolean
}

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
const SHORT_DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
/** A day without a time means the end of that working day, as for model deadlines. */
const END_OF_DAY_HOUR = 17

interface Found {
  value: number
  match: string
}

function findDay(text: string, now: Date): (Found & { offset: number }) | null {
  const relative = text.match(/\b(?:by\s+|on\s+)?(today|tonight|tomorrow|tmrw|eod)\b/i)
  if (relative) {
    const word = relative[1]!.toLowerCase()
    const offset = word === 'tomorrow' || word === 'tmrw' ? 1 : 0
    return { value: -1, offset, match: relative[0] }
  }
  const names = [...DAYS, ...SHORT_DAYS].join('|')
  const weekday = text.match(new RegExp(`\\b(?:by\\s+|on\\s+)?(?:next\\s+|this\\s+)?(${names})\\b`, 'i'))
  if (weekday) {
    const name = weekday[1]!.toLowerCase()
    const index = DAYS.findIndex((day) => day === name || day.startsWith(name))
    const delta = (index - now.getDay() + 7) % 7
    return { value: index, offset: delta === 0 ? 7 : delta, match: weekday[0] }
  }
  return null
}

function findTime(text: string): (Found & { minutes: number }) | null {
  if (/\b(?:at\s+)?noon\b/i.test(text)) {
    return { value: 12, minutes: 0, match: text.match(/\b(?:at\s+)?noon\b/i)![0] }
  }
  const twelve = text.match(/\b(?:at\s+|by\s+)?(1[0-2]|0?[1-9])(?::([0-5]\d))?\s*(am|pm)\b/i)
  if (twelve) {
    let hour = Number(twelve[1]) % 12
    if (twelve[3]!.toLowerCase() === 'pm') hour += 12
    return { value: hour, minutes: Number(twelve[2] ?? 0), match: twelve[0] }
  }
  const twentyFour = text.match(/\b(?:at\s+|by\s+)?([01]?\d|2[0-3]):([0-5]\d)\b/)
  if (twentyFour) {
    return { value: Number(twentyFour[1]), minutes: Number(twentyFour[2]), match: twentyFour[0] }
  }
  return null
}

function dayLabel(date: Date, now: Date): string {
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  const that = new Date(date)
  that.setHours(0, 0, 0, 0)
  const days = Math.round((that.getTime() - today.getTime()) / 86_400_000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Tomorrow'
  if (days < 7) return date.toLocaleDateString(undefined, { weekday: 'long' })
  return date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
}

function tidy(title: string): string {
  return title
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:])/g, '$1')
    .replace(/(?:\s|^)(?:by|on|at|due)\s*$/i, '')
    .replace(/^[\s,;:–-]+|[\s,;:–-]+$/g, '')
    .trim()
}

export function parseCapture(input: string, now: Date = new Date()): ParsedCapture {
  const text = input.trim()
  const screen = isScreenCaptureIntent(text)
  const recurrence = parseRecurrence(text)
  if (recurrence) {
    return { title: recurrence.title, deadline: null, deadlineLabel: null, priority: null, people: [], recurrence, screen }
  }

  let title = text
  const people: string[] = []
  title = title.replace(/(?:^|\s)@([\p{L}][\p{L}'-]*)/gu, (_, name: string) => {
    people.push(name)
    return ` ${name}`
  })
  for (const match of text.matchAll(/\bwith\s+([\p{Lu}][\p{L}'-]+)/gu)) {
    if (!people.includes(match[1]!)) people.push(match[1]!)
  }

  let priority: TaskPriority | null = null
  if (/\b(?:urgent|asap)\b|!{2,}|!\s*$/i.test(text)) priority = 'urgent'
  else if (/\b(?:important|high priority)\b/i.test(text)) priority = 'high'
  else if (/\blow priority\b/i.test(text)) priority = 'low'
  title = title.replace(/\s*!+\s*$/, '').replace(/\b(?:asap|high priority|low priority)\b/gi, ' ')

  const day = findDay(title, now)
  const time = findTime(title)
  let deadline: Date | null = null
  if (day || time) {
    deadline = new Date(now)
    deadline.setSeconds(0, 0)
    if (day) deadline.setDate(now.getDate() + day.offset)
    if (time) deadline.setHours(time.value, time.minutes)
    else if (/tonight/i.test(day!.match)) deadline.setHours(20, 0)
    else deadline.setHours(END_OF_DAY_HOUR, 0)
    // "at 9am" said at noon means tomorrow morning, not three hours ago.
    if (!day && deadline.getTime() <= now.getTime()) deadline.setDate(deadline.getDate() + 1)
    if (day) title = title.replace(day.match, ' ')
    if (time) title = title.replace(time.match, ' ')
  }

  const label = deadline
    ? `${dayLabel(deadline, now)}, ${deadline.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`
    : null

  return {
    title: tidy(title) || text,
    deadline: deadline ? deadline.toISOString() : null,
    deadlineLabel: label,
    priority,
    people,
    recurrence: null,
    screen
  }
}
