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
  // "EOD tomorrow" is tomorrow: the day word wins over the time-of-day one.
  const relative =
    text.match(/\b(?:by\s+|on\s+)?(tomorrow|tmrw)\b/i) ??
    text.match(/\b(?:by\s+|on\s+)?(today|tonight|eod|(?:the\s+)?end of (?:the\s+)?day)\b/i)
  if (relative) {
    const word = relative[1]!.toLowerCase()
    const offset = word === 'tomorrow' || word === 'tmrw' ? 1 : 0
    return { value: -1, offset, match: relative[0] }
  }
  // The working week ends on Friday; said at the weekend, that is the coming one.
  const endOf = text.match(/\b(?:by\s+)?(?:the\s+)?end of (?:the\s+|this\s+)?(week|month)\b/i)
  if (endOf) {
    if (endOf[1]!.toLowerCase() === 'week') return { value: 5, offset: (5 - now.getDay() + 7) % 7, match: endOf[0] }
    const last = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
    return { value: -1, offset: last - now.getDate(), match: endOf[0] }
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

const COUNTS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  fifteen: 15, twenty: 20, thirty: 30, forty: 40, 'forty-five': 45, 'a couple of': 2, 'a few': 3
}

/** "in an hour", "in 20 minutes", "in two days", "next week": counted from now. */
function findRelative(text: string, now: Date): { minutes: number; days: number; match: string } | null {
  const half = text.match(/\bin\s+half\s+an?\s+hour\b/i)
  if (half) return { minutes: 30, days: 0, match: half[0] }
  const counted = text.match(
    /\bin\s+(\d+|a couple of|a few|an?|one|two|three|four|five|six|seven|eight|nine|ten|fifteen|twenty|thirty|forty-five|forty)\s+(min(?:ute)?s?|hours?|hrs?|days?|weeks?)\b/i
  )
  if (counted) {
    const count = Number(counted[1]) || COUNTS[counted[1]!.toLowerCase()] || 1
    const unit = counted[2]!.toLowerCase()
    if (unit.startsWith('min')) return { minutes: count, days: 0, match: counted[0] }
    if (unit.startsWith('h')) return { minutes: count * 60, days: 0, match: counted[0] }
    return { minutes: 0, days: unit.startsWith('w') ? count * 7 : count, match: counted[0] }
  }
  // Next week starts on its Monday.
  const nextWeek = text.match(/\b(?:by\s+|until\s+)?next\s+week\b/i)
  if (nextWeek) return { minutes: 0, days: ((8 - now.getDay()) % 7) || 7, match: nextWeek[0] }
  return null
}

const ASKING = /^(?:please\s+)?(?:remind me to|remember to|don'?t forget to|i need to|i have to|need to)\s+/i

function findTime(text: string): (Found & { minutes: number }) | null {
  if (/\b(?:at\s+)?noon\b/i.test(text)) {
    return { value: 12, minutes: 0, match: text.match(/\b(?:at\s+)?noon\b/i)![0] }
  }
  // "Good morning" is a greeting, not a time.
  const part = text.match(/(?<!\bgood\s)\b(?:by\s+|in\s+the\s+|this\s+)?(morning|afternoon|evening)\b/i)
  if (part) {
    const hour = { morning: 9, afternoon: 15, evening: 19 }[part[1]!.toLowerCase() as 'morning' | 'afternoon' | 'evening']
    return { value: hour, minutes: 0, match: part[0] }
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

const PRIORITY_TAG = /^(?:urgent|important)\s*[:,–-]\s*|[\s,;:–-]+(?:urgent|important)$/i

function tidy(title: string): string {
  return title
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:])/g, '$1')
    .replace(/(?:\s|^)(?:by|on|at|due)\s*$/i, '')
    // Dictation ends sentences with a period; a title doesn't need one.
    .replace(/^[\s,;:–-]+|[\s,;:.–-]+$/g, '')
    .trim()
}

/**
 * Deadline words copied from a message ("EOD tomorrow", "by Thursday 2pm"),
 * resolved against when it was sent. Models get the words right far more
 * often than the arithmetic.
 */
export function resolveWhen(when: string, sentAt: Date): string | null {
  const parsed = parseCapture(`x ${when}`, sentAt)
  return parsed.recurrence ? null : parsed.deadline
}

/** Timing the parser didn't turn into a date: words it doesn't know, still in the title. */
const UNPARSED_TIME =
  /\b(?:morning|afternoon|evening|noon|midnight|next|weeks?|weekend|months?|before|until|due|deadline|end of|in \d+ (?:min(?:ute)?s?|hours?|days?|weeks?)|(?:mon|tues?|wed(?:nes)?|thu(?:rs)?|fri|sat(?:ur)?|sun)(?:day)?|jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?|\d{1,2}(?::\d{2})?\s*(?:am|pm)|\d{1,2}\/\d{1,2})\b/i

/**
 * Whether the model could add anything the parser didn't. It finds timing and
 * tidies long, rambling input; a short title with no timing words left in it
 * gains nothing from a model call, so Quick Add skips it.
 */
export function needsEnrichment(parsed: ParsedCapture): boolean {
  if (parsed.recurrence || parsed.screen) return false
  if (UNPARSED_TIME.test(parsed.title)) return true
  return parsed.title.split(/\s+/).length > 10
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

  if (ASKING.test(title) && title.replace(ASKING, '').trim()) title = title.replace(ASKING, '')

  const relative = findRelative(title, now)
  let deadline: Date | null = null
  if (relative) {
    title = title.replace(relative.match, ' ')
    if (relative.minutes) {
      deadline = new Date(now.getTime() + relative.minutes * 60_000)
      deadline.setSeconds(0, 0)
      // "today in an hour": the hour already says when.
      title = title.replace(/\b(?:today|tonight|now)\b/i, ' ')
    } else {
      deadline = new Date(now)
      deadline.setSeconds(0, 0)
      deadline.setDate(now.getDate() + relative.days)
      const time = findTime(title)
      if (time) {
        deadline.setHours(time.value, time.minutes)
        title = title.replace(time.match, ' ')
      } else {
        deadline.setHours(/next\s+week/i.test(relative.match) ? 9 : END_OF_DAY_HOUR, 0)
      }
    }
  }

  const day = relative ? null : findDay(title, now)
  const time = relative ? null : findTime(title)
  if (day || time) {
    deadline = new Date(now)
    deadline.setSeconds(0, 0)
    if (day) deadline.setDate(now.getDate() + day.offset)
    if (time) deadline.setHours(time.value, time.minutes)
    else if (/tonight/i.test(day!.match)) deadline.setHours(20, 0)
    else deadline.setHours(END_OF_DAY_HOUR, 0)
    // "at 9am" said at noon means tomorrow morning, not three hours ago.
    if (!day && deadline.getTime() <= now.getTime()) deadline.setDate(deadline.getDate() + 1)
    if (day) title = title.replace(day.match, ' ').replace(/\b(?:by\s+)?(?:eod|(?:the\s+)?end of (?:the\s+)?day)\b/i, ' ')
    if (time) title = title.replace(time.match, ' ')
  }

  const label = deadline
    ? `${dayLabel(deadline, now)}, ${deadline.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`
    : null

  // "Urgent: pay rent", "pay rent, urgent": a tag, once the dates are out.
  // In the middle it's content ("reply to the urgent mail").
  if (priority) title = tidy(title).replace(PRIORITY_TAG, '')
  const tidied = tidy(title) || text
  return {
    // Capitalised here, since the model is no longer always asked to.
    title: tidied.charAt(0).toUpperCase() + tidied.slice(1),
    deadline: deadline ? deadline.toISOString() : null,
    deadlineLabel: label,
    priority,
    people,
    recurrence: null,
    screen
  }
}
