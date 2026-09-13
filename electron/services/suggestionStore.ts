import { randomUUID } from 'node:crypto'
import { detectRecurrences, type DetectedRecurrence } from '@shared/recurrenceDetect'
import type { RecurrenceSuggestion } from '@shared/types'
import { addRule } from './ruleStore'
import { getTaskStore } from './taskStore'

interface SuggestionRow {
  id: string
  signature: string
  title: string
  weekdays: string
  time_of_day: string
  occurrences: number
  status: RecurrenceSuggestion['status']
  created_at: string
  decided_at: string | null
}

function toSuggestion(row: SuggestionRow): RecurrenceSuggestion {
  return {
    id: row.id,
    signature: row.signature,
    title: row.title,
    weekdays: JSON.parse(row.weekdays) as number[],
    time: row.time_of_day,
    occurrences: row.occurrences,
    status: row.status,
    createdAt: row.created_at
  }
}

export function listPendingSuggestions(): RecurrenceSuggestion[] {
  return getTaskStore()
    .prepare<[], SuggestionRow>(
      `SELECT * FROM recurrence_suggestions WHERE status = 'pending' ORDER BY occurrences DESC`
    )
    .all()
    .map(toSuggestion)
}

/**
 * Rows the detector should look at. Rule-materialised tasks are excluded:
 * counting them would let one rule "confirm" itself into a second rule.
 */
function observedTasks(): { title: string; at: string }[] {
  return getTaskStore()
    .prepare<[], { title: string; at: string }>(
      `SELECT title, COALESCE(deadline, created_at) AS at
       FROM tasks
       WHERE source != 'rule'`
    )
    .all()
}

/**
 * Records new patterns as *pending* suggestions. Nothing is created and
 * nothing is shown twice: an existing row (including a dismissed one) only has
 * its occurrence count refreshed.
 */
export function refreshSuggestions(now = new Date()): RecurrenceSuggestion[] {
  const db = getTaskStore()
  const detected: DetectedRecurrence[] = detectRecurrences(observedTasks(), { now })

  // A pattern that already has a matching live rule is not news.
  const ruled = new Set(
    db
      .prepare<[], { title: string }>(`SELECT title FROM recurrence_rules WHERE enabled = 1`)
      .all()
      .map((row) => row.title.trim().toLowerCase())
  )

  const upsert = db.prepare(
    `INSERT INTO recurrence_suggestions
       (id, signature, title, weekdays, time_of_day, occurrences, status, created_at)
     VALUES (@id, @signature, @title, @weekdays, @time_of_day, @occurrences, 'pending', @created_at)
     ON CONFLICT (signature) DO UPDATE SET
       occurrences = excluded.occurrences,
       time_of_day = excluded.time_of_day`
  )

  db.transaction(() => {
    for (const item of detected) {
      if (ruled.has(item.title.trim().toLowerCase())) continue
      upsert.run({
        id: randomUUID(),
        signature: item.signature,
        title: item.title,
        weekdays: JSON.stringify(item.weekdays),
        time_of_day: item.time,
        occurrences: item.occurrences,
        created_at: now.toISOString()
      })
    }
  })()

  return listPendingSuggestions()
}

function decide(id: string, status: 'accepted' | 'dismissed') {
  getTaskStore()
    .prepare(`UPDATE recurrence_suggestions SET status = ?, decided_at = ? WHERE id = ?`)
    .run(status, new Date().toISOString(), id)
}

/** Turns a suggestion into a real rule. Only ever called from a user action. */
export function acceptSuggestion(id: string) {
  const row = getTaskStore()
    .prepare<[string], SuggestionRow>(`SELECT * FROM recurrence_suggestions WHERE id = ?`)
    .get(id)
  if (!row) return null

  const suggestion = toSuggestion(row)
  const rule = addRule({
    title: suggestion.title,
    weekdays: suggestion.weekdays,
    time: suggestion.time,
    priority: 'medium',
    leadMinutes: 0,
    enabled: true,
    source: 'suggested'
  })
  decide(id, 'accepted')
  return rule
}

export function dismissSuggestion(id: string) {
  decide(id, 'dismissed')
}
