import { randomUUID } from 'node:crypto'
import {
  normaliseSubject,
  recallFor,
  shouldSuppress,
  type Decision,
  type DecisionKind,
  type Suppression
} from '@shared/decisions'
import { getTaskStore } from './taskStore'

/**
 * How far back decisions count. A year-old deletion says little about what the
 * user wants now, and an unbounded log would make every suppression permanent.
 */
const WINDOW_DAYS = 120

interface DecisionRow {
  id: string
  kind: DecisionKind
  subject: string
  title: string
  source: string | null
  detail: string | null
  decided_at: string
}

function toDecision(row: DecisionRow): Decision {
  return {
    id: row.id,
    kind: row.kind,
    subject: row.subject,
    title: row.title,
    source: row.source,
    detail: row.detail,
    decidedAt: row.decided_at
  }
}

export function recordDecision(input: {
  kind: DecisionKind
  title: string
  source?: string | null
  detail?: string | null
}): void {
  const subject = normaliseSubject(input.title)
  // An empty subject cannot be matched against anything later, so storing it
  // would only add noise to the log the user is shown.
  if (!subject) return

  getTaskStore()
    .prepare(
      `INSERT INTO decisions (id, kind, subject, title, source, detail, decided_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      randomUUID(),
      input.kind,
      subject,
      input.title.trim(),
      input.source ?? null,
      input.detail ?? null,
      new Date().toISOString()
    )
}

export function listDecisions(limit = 500): Decision[] {
  const cutoff = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString()
  return getTaskStore()
    .prepare<[string, number], DecisionRow>(
      `SELECT * FROM decisions WHERE decided_at >= ? ORDER BY decided_at DESC LIMIT ?`
    )
    .all(cutoff, limit)
    .map(toDecision)
}

/** What the user already settled about something like this. */
export function recallDecisions(title: string, limit = 5): Decision[] {
  return recallFor(listDecisions(), title, limit)
}

export function suppressionFor(title: string): Suppression {
  return shouldSuppress(listDecisions(), title)
}

/**
 * Titles the user has repeatedly deleted, with the count. Shown in Settings so
 * the learning is inspectable rather than a mystery — a list that quietly
 * hides things has to be able to say what it is hiding.
 */
export function learnedSuppressions(): { title: string; deletes: number }[] {
  const decisions = listDecisions()
  const seen = new Set<string>()
  const out: { title: string; deletes: number }[] = []

  for (const decision of decisions) {
    if (seen.has(decision.subject)) continue
    seen.add(decision.subject)
    const verdict = shouldSuppress(decisions, decision.title)
    if (verdict.suppressed) out.push({ title: decision.title, deletes: verdict.deletes })
  }
  return out.sort((a, b) => b.deletes - a.deletes)
}

/** Undo a learned suppression, so a wrong lesson is correctable. */
export function forgetSubject(title: string): void {
  getTaskStore()
    .prepare(`DELETE FROM decisions WHERE subject = ? AND kind = 'deleted'`)
    .run(normaliseSubject(title))
}
