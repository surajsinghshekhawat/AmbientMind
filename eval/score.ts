import type { ExtractedTask } from '../electron/services/ollama'
import type { GoldTask, LabelledMessage, Metrics } from './types'

/**
 * A predicted title never matches a gold title verbatim, so pairs are matched on
 * content-word overlap. 0.5 keeps "Send the Q3 budget report to Sarah" matched
 * against "send Q3 budget to Sarah" while rejecting unrelated tasks.
 */
const MATCH_THRESHOLD = 0.5

const STOPWORDS = new Set([
  'a', 'an', 'the', 'to', 'for', 'of', 'and', 'on', 'in', 'at', 'by', 'with',
  'from', 'about', 'please', 'my', 'our', 'your', 'this', 'that', 'it'
])

function tokens(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((word) => word.length > 1 && !STOPWORDS.has(word))
  )
}

/** Dice coefficient over content words. */
export function similarity(a: string, b: string): number {
  const ta = tokens(a)
  const tb = tokens(b)
  if (ta.size === 0 || tb.size === 0) return 0
  let shared = 0
  for (const token of ta) if (tb.has(token)) shared++
  return (2 * shared) / (ta.size + tb.size)
}

function sameCalendarDay(a: string | null, b: string | null): boolean {
  if (a === null && b === null) return true
  if (a === null || b === null) return false
  return new Date(a).toDateString() === new Date(b).toDateString()
}

interface Pairing {
  matched: { gold: GoldTask; predicted: ExtractedTask }[]
  unmatchedGold: GoldTask[]
  unmatchedPredicted: ExtractedTask[]
}

/**
 * Greedy highest-similarity-first assignment. Optimal bipartite matching would
 * be tidier, but at these list lengths (rarely more than three tasks) greedy and
 * optimal agree, and greedy is auditable by hand.
 */
export function pair(gold: GoldTask[], predicted: ExtractedTask[]): Pairing {
  const candidates: { g: number; p: number; score: number }[] = []
  gold.forEach((g, gi) =>
    predicted.forEach((p, pi) => {
      const score = similarity(g.title, p.title)
      if (score >= MATCH_THRESHOLD) candidates.push({ g: gi, p: pi, score })
    })
  )
  candidates.sort((a, b) => b.score - a.score)

  const usedGold = new Set<number>()
  const usedPredicted = new Set<number>()
  const matched: Pairing['matched'] = []

  for (const candidate of candidates) {
    if (usedGold.has(candidate.g) || usedPredicted.has(candidate.p)) continue
    usedGold.add(candidate.g)
    usedPredicted.add(candidate.p)
    matched.push({ gold: gold[candidate.g]!, predicted: predicted[candidate.p]! })
  }

  return {
    matched,
    unmatchedGold: gold.filter((_, i) => !usedGold.has(i)),
    unmatchedPredicted: predicted.filter((_, i) => !usedPredicted.has(i))
  }
}

export interface ScoredMessage {
  id: string
  gold: GoldTask[]
  predicted: ExtractedTask[]
  truePositives: number
  falsePositives: number
  falseNegatives: number
  latencyMs: number
}

export function scoreMessage(
  message: LabelledMessage,
  predicted: ExtractedTask[],
  latencyMs: number
): ScoredMessage {
  const { matched, unmatchedGold, unmatchedPredicted } = pair(message.goldTasks, predicted)
  return {
    id: message.id,
    gold: message.goldTasks,
    predicted,
    truePositives: matched.length,
    falsePositives: unmatchedPredicted.length,
    falseNegatives: unmatchedGold.length,
    latencyMs
  }
}

export function aggregate(scored: ScoredMessage[], corpus: LabelledMessage[]): Metrics {
  const tp = scored.reduce((sum, s) => sum + s.truePositives, 0)
  const fp = scored.reduce((sum, s) => sum + s.falsePositives, 0)
  const fn = scored.reduce((sum, s) => sum + s.falseNegatives, 0)

  const precision = tp + fp === 0 ? 1 : tp / (tp + fp)
  const recall = tp + fn === 0 ? 1 : tp / (tp + fn)
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall)

  const byId = new Map(corpus.map((m) => [m.id, m]))
  const taskFree = scored.filter((s) => (byId.get(s.id)?.goldTasks.length ?? 0) === 0)
  const emptySpecificity =
    taskFree.length === 0
      ? 1
      : taskFree.filter((s) => s.predicted.length === 0).length / taskFree.length

  let deadlineHits = 0
  let deadlineTotal = 0
  for (const s of scored) {
    const message = byId.get(s.id)
    if (!message) continue
    for (const { gold, predicted } of pair(message.goldTasks, s.predicted).matched) {
      deadlineTotal++
      if (sameCalendarDay(gold.deadline, predicted.deadline)) deadlineHits++
    }
  }

  return {
    truePositives: tp,
    falsePositives: fp,
    falseNegatives: fn,
    precision,
    recall,
    f1,
    emptySpecificity,
    deadlineAccuracy: deadlineTotal === 0 ? 1 : deadlineHits / deadlineTotal,
    messagesScored: scored.length
  }
}
