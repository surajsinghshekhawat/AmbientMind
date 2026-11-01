import type { TaskSource } from './types'

/**
 * Sources whose tasks can be forgotten from "Your data". Reminders are left
 * out because they live in Apple Reminders too and would sync straight back;
 * recurring tasks are managed as rules.
 */
export const ERASABLE_SOURCES = ['gmail', 'gcalendar', 'acalendar', 'screen', 'voice', 'chat', 'manual'] as const
export type ErasableSource = (typeof ERASABLE_SOURCES)[number]

export function isErasableSource(value: unknown): value is ErasableSource {
  return typeof value === 'string' && (ERASABLE_SOURCES as readonly string[]).includes(value)
}

export const INVENTORY_SOURCE_LABEL: Record<TaskSource, string> = {
  gmail: 'Gmail',
  gcalendar: 'Google Calendar',
  acalendar: 'Apple Calendar',
  reminders: 'Apple Reminders',
  outlook: 'Outlook',
  teams: 'Teams',
  voice: 'Voice',
  screen: 'Screen',
  chat: 'Chat',
  manual: 'Typed by you',
  rule: 'Recurring'
}

export interface SourceCount {
  source: TaskSource
  /** Pending, snoozed or suggested. */
  open: number
  /** Done or archived. */
  finished: number
}

export interface DataInventory {
  tasks: SourceCount[]
  /** Deleted tasks kept so a sync doesn't bring them back. */
  tombstones: number
  /** Mail and calendar items already read, by id only. */
  itemsRead: number
  /** Past mail kept, with what was found in it, to guide the model. */
  examples: number
  decisions: number
  rules: number
  chatTurns: number
  aiCalls: number
  networkRequests: number
  oldest: string | null
  dataFolder: string
}

export const FORGET_AGES = [
  { days: 30, label: '30 days' },
  { days: 90, label: '3 months' },
  { days: 365, label: 'a year' }
] as const

export function cutoffFor(days: number, now = Date.now()): string {
  return new Date(now - days * 86_400_000).toISOString()
}
