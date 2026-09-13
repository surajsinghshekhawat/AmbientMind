import { similarity } from './similarity'

export type DecisionKind = 'completed' | 'deleted' | 'snoozed' | 'dismissed_suggestion'

export interface Decision {
  id: string
  kind: DecisionKind
  /** Normalised title, so variations of one commitment group together. */
  subject: string
  title: string
  source: string | null
  detail: string | null
  decidedAt: string
}

/**
 * Deleting the same thing this many times is a preference, not an accident.
 *
 * Three rather than two: people delete things by mistake, and the cost of
 * getting this wrong is silently hiding a task the user wanted. Suppression
 * has to be slower to trigger than annoyance is to feel.
 */
export const SUPPRESS_AFTER_DELETES = 3

/** Matches the recurrence detector, so "one habit" means one thing everywhere. */
const SAME_SUBJECT = 0.72

export function normaliseSubject(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function sameSubject(a: string, b: string): boolean {
  return a === b || similarity(a, b) >= SAME_SUBJECT
}

/** Decisions about roughly this thing, newest first. */
export function recallFor(decisions: Decision[], title: string, limit = 5): Decision[] {
  const subject = normaliseSubject(title)
  return decisions
    .filter((decision) => sameSubject(decision.subject, subject))
    .sort((a, b) => b.decidedAt.localeCompare(a.decidedAt))
    .slice(0, limit)
}

export interface Suppression {
  suppressed: boolean
  deletes: number
  /** Only set when suppressed, so the UI can explain rather than just hide. */
  reason?: string
}

/**
 * Whether a task like this should be kept out of the list.
 *
 * Completing something once outweighs any number of deletions: it proves the
 * user does sometimes want it, and a task wrongly suppressed is invisible —
 * there is no way for them to discover the mistake or correct it.
 */
export function shouldSuppress(decisions: Decision[], title: string): Suppression {
  const relevant = recallFor(decisions, title, Number.MAX_SAFE_INTEGER)
  const deletes = relevant.filter((d) => d.kind === 'deleted').length
  const completions = relevant.filter((d) => d.kind === 'completed').length

  if (completions > 0 || deletes < SUPPRESS_AFTER_DELETES) {
    return { suppressed: false, deletes }
  }
  return {
    suppressed: true,
    deletes,
    reason: `You deleted this ${deletes} times without ever completing it.`
  }
}

/** Compact lines for a prompt: what the user already settled about this. */
export function describeDecisions(decisions: Decision[]): string[] {
  return decisions.map((decision) => {
    const when = decision.decidedAt.slice(0, 10)
    switch (decision.kind) {
      case 'completed':
        return `${when}: completed "${decision.title}"`
      case 'deleted':
        return `${when}: deleted "${decision.title}" without doing it`
      case 'snoozed':
        return `${when}: pushed "${decision.title}" back${
          decision.detail ? ` to ${decision.detail}` : ''
        }`
      case 'dismissed_suggestion':
        return `${when}: said "${decision.title}" is not a recurring commitment`
    }
  })
}
