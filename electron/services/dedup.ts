import { similarity } from '@shared/similarity'
import type { Task } from '@shared/types'
import type { NewTask } from './taskStore'

/**
 * Same-source repeats are already impossible: the unique index on
 * (source, source_id) rejects them at insert time. This layer handles the case
 * that index cannot see — the same real-world task arriving through two
 * different sources, typically a message that lands in both Gmail and Outlook,
 * or a meeting that is both a calendar event and an email thread.
 */

/** Titles must be this close before deadlines are even considered. */
const TITLE_THRESHOLD = 0.72

/** Two tasks about the same thing rarely land more than a day apart. */
const DEADLINE_TOLERANCE_MS = 24 * 3_600_000

function deadlinesCompatible(a: string | null, b: string | null): boolean {
  // One side simply not knowing a deadline is not evidence of a different task.
  if (a === null || b === null) return true
  return Math.abs(Date.parse(a) - Date.parse(b)) <= DEADLINE_TOLERANCE_MS
}

export function isDuplicate(candidate: NewTask, existing: Task): boolean {
  if (existing.status === 'archived') return false
  if (existing.source === candidate.source && existing.sourceId === candidate.sourceId) return true

  return (
    similarity(candidate.title, existing.title) >= TITLE_THRESHOLD &&
    deadlinesCompatible(candidate.deadline ?? null, existing.deadline)
  )
}

/**
 * Filters candidates against the live task list and against each other, so a
 * single sync pass cannot insert two phrasings of the same task.
 */
export function rejectDuplicates(
  candidates: NewTask[],
  existing: Task[]
): { accepted: NewTask[]; rejected: { task: NewTask; reason: string }[] } {
  const accepted: NewTask[] = []
  const rejected: { task: NewTask; reason: string }[] = []

  for (const candidate of candidates) {
    const clash = existing.find((task) => isDuplicate(candidate, task))
    if (clash) {
      rejected.push({ task: candidate, reason: `matches existing task ${clash.id}` })
      continue
    }

    const withinBatch = accepted.find(
      (other) =>
        similarity(candidate.title, other.title) >= TITLE_THRESHOLD &&
        deadlinesCompatible(candidate.deadline ?? null, other.deadline ?? null)
    )
    if (withinBatch) {
      rejected.push({ task: candidate, reason: 'duplicate within the same sync batch' })
      continue
    }

    accepted.push(candidate)
  }

  return { accepted, rejected }
}
