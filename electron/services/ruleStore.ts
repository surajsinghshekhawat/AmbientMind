import { randomUUID } from 'node:crypto'
import {
  occurrenceKey,
  occurrencesWithin,
  type NewRecurrenceRule,
  type RecurrenceRule
} from '@shared/recurrence'
import type { TaskPriority } from '@shared/types'
import { addTasksIgnoringDuplicates, getTaskStore, type NewTask } from './taskStore'

/**
 * Two weeks ahead: far enough that a rule is visibly "set up", short enough
 * that editing or disabling it does not leave months of stale rows behind.
 */
export const MATERIALISE_HORIZON_DAYS = 14

interface RuleRow {
  id: string
  title: string
  weekdays: string
  time_of_day: string
  priority: TaskPriority
  lead_minutes: number
  enabled: number
  created_at: string
  source: RecurrenceRule['source']
  /** Event mirroring this rule on the app's calendar; null until pushed. */
  gcal_event_id?: string | null
}

/**
 * The calendar link is storage detail, not part of the rule as the rest of the
 * app understands it, so it is read and written on its own rather than being
 * threaded through `RecurrenceRule`.
 */
export function getRuleEventId(id: string): string | null {
  return (
    getTaskStore()
      .prepare<[string], { gcal_event_id: string | null }>(
        `SELECT gcal_event_id FROM recurrence_rules WHERE id = ?`
      )
      .get(id)?.gcal_event_id ?? null
  )
}

export function setRuleEventId(id: string, eventId: string | null): void {
  getTaskStore()
    .prepare(`UPDATE recurrence_rules SET gcal_event_id = ? WHERE id = ?`)
    .run(eventId, id)
}

export function getRule(id: string): RecurrenceRule | null {
  const row = getTaskStore()
    .prepare<[string], RuleRow>(`SELECT * FROM recurrence_rules WHERE id = ?`)
    .get(id)
  return row ? toRule(row) : null
}

function toRule(row: RuleRow): RecurrenceRule {
  return {
    id: row.id,
    title: row.title,
    weekdays: JSON.parse(row.weekdays) as number[],
    time: row.time_of_day,
    priority: row.priority,
    leadMinutes: row.lead_minutes,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    source: row.source
  }
}

export function listRules(): RecurrenceRule[] {
  return getTaskStore()
    .prepare<[], RuleRow>(`SELECT * FROM recurrence_rules ORDER BY created_at`)
    .all()
    .map(toRule)
}

export function addRule(input: NewRecurrenceRule): RecurrenceRule {
  const row: RuleRow = {
    id: input.id ?? randomUUID(),
    title: input.title.trim(),
    weekdays: JSON.stringify([...new Set(input.weekdays)].sort((a, b) => a - b)),
    time_of_day: input.time,
    priority: input.priority ?? 'medium',
    lead_minutes: input.leadMinutes ?? 0,
    enabled: input.enabled === false ? 0 : 1,
    created_at: input.createdAt ?? new Date().toISOString(),
    source: input.source ?? 'explicit'
  }

  getTaskStore()
    .prepare(
      `INSERT INTO recurrence_rules
         (id, title, weekdays, time_of_day, priority, lead_minutes, enabled, created_at, source)
       VALUES
         (@id, @title, @weekdays, @time_of_day, @priority, @lead_minutes, @enabled, @created_at, @source)`
    )
    .run(row)

  return toRule(row)
}

export type RulePatch = Partial<Pick<RecurrenceRule, 'title' | 'weekdays' | 'time' | 'priority' | 'enabled'>>

export function updateRule(id: string, patch: RulePatch): void {
  const assignments: string[] = []
  const params: unknown[] = []

  if (patch.title !== undefined) {
    assignments.push('title = ?')
    params.push(patch.title.trim())
  }
  if (patch.weekdays !== undefined) {
    assignments.push('weekdays = ?')
    params.push(JSON.stringify([...new Set(patch.weekdays)].sort((a, b) => a - b)))
  }
  if (patch.time !== undefined) {
    assignments.push('time_of_day = ?')
    params.push(patch.time)
  }
  if (patch.priority !== undefined) {
    assignments.push('priority = ?')
    params.push(patch.priority)
  }
  if (patch.enabled !== undefined) {
    assignments.push('enabled = ?')
    params.push(patch.enabled ? 1 : 0)
  }
  if (assignments.length === 0) return

  params.push(id)
  getTaskStore()
    .prepare(`UPDATE recurrence_rules SET ${assignments.join(', ')} WHERE id = ?`)
    .run(...params)
}

/** Returns the calendar event that was mirroring the rule, so it can be removed. */
export function deleteRule(id: string): { eventId: string | null } {
  const eventId = getRuleEventId(id)
  getTaskStore().transaction(() => {
    getTaskStore().prepare(`DELETE FROM recurrence_rules WHERE id = ?`).run(id)
    // Occurrences already completed are history and stay; anything still
    // pending would be a task the user can no longer explain.
    getTaskStore()
      .prepare(
        `DELETE FROM tasks WHERE source = 'rule' AND status = 'pending' AND source_id LIKE ?`
      )
      .run(`${id}:%`)
  })()
  return { eventId }
}

/** Pending occurrences of a rule that no longer match it, e.g. after a retime. */
function dropStaleOccurrences(rule: RecurrenceRule, keep: Set<string>): number {
  const rows = getTaskStore()
    .prepare<[string], { source_id: string }>(
      `SELECT source_id FROM tasks
       WHERE source = 'rule' AND status = 'pending' AND source_id LIKE ?`
    )
    .all(`${rule.id}:%`)

  let removed = 0
  for (const row of rows) {
    if (keep.has(row.source_id)) continue
    getTaskStore()
      .prepare(`DELETE FROM tasks WHERE source = 'rule' AND source_id = ? AND status = 'pending'`)
      .run(row.source_id)
    removed++
  }
  return removed
}

export interface MaterialiseResult {
  created: number
  removed: number
}

/**
 * Idempotent: the unique index on (source, source_id) means running this every
 * few minutes cannot duplicate an occurrence, so it is safe to call from the
 * scheduler, at launch, and immediately after a rule is edited.
 */
export function materialiseRules(
  now = new Date(),
  horizonDays = MATERIALISE_HORIZON_DAYS
): MaterialiseResult {
  let created = 0
  let removed = 0

  for (const rule of listRules()) {
    if (!rule.enabled) {
      removed += dropStaleOccurrences(rule, new Set())
      continue
    }

    const occurrences = occurrencesWithin(rule, now, horizonDays)
    const keep = new Set<string>()
    const tasks: NewTask[] = []

    for (const at of occurrences) {
      const key = occurrenceKey(rule.id, at)
      keep.add(key)
      const due = new Date(at.getTime() - rule.leadMinutes * 60_000)
      tasks.push({
        title: rule.title,
        deadline: due.toISOString(),
        priority: rule.priority,
        source: 'rule',
        sourceId: key,
        rawContext: `Recurring: ${rule.title}`,
        confidence: 1
      })
    }

    removed += dropStaleOccurrences(rule, keep)
    created += addTasksIgnoringDuplicates(tasks).length
  }

  return { created, removed }
}
