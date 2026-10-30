/**
 * Background housekeeping for tables that otherwise only ever grow.
 *
 * Nothing in this app deleted an example, a processed-message record or a
 * decision until this file existed. That was invisible at a few dozen rows and
 * would not have stayed invisible: `sqlite-vec` scans every stored vector on
 * every retrieval, so an uncapped corpus makes each sync slower than the last
 * with no symptom other than gradual sluggishness — the same silent class of
 * problem as the message-retry bug.
 */
import { KEEP_DECISIONS, KEEP_EXAMPLES, KEEP_PROCESSED_DAYS } from '@shared/retention'
import { isAiPaused } from '@shared/pauseAi'
import { embed, EMBED_VERSION } from './ollama'
import { loadConfig } from './config'
import { getTaskStore } from './taskStore'
import {
  pruneExamples,
  replaceEmbedding,
  staleEmbeddings,
  truncateExample
} from './vectorStore'

export { KEEP_DECISIONS, KEEP_EXAMPLES, KEEP_PROCESSED_DAYS }

/** Re-embedding is a model call each, so a sweep does a few and comes back. */
const BACKFILL_BATCH = 25

export interface MaintenanceReport {
  examplesPruned: number
  processedPruned: number
  decisionsPruned: number
}

function pruneProcessed(days: number): number {
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString()
  const { changes } = getTaskStore()
    .prepare(`DELETE FROM processed_messages WHERE processed_at < ?`)
    .run(cutoff)
  return changes
}

function pruneDecisions(keep: number): number {
  const { changes } = getTaskStore()
    .prepare(
      `DELETE FROM decisions
        WHERE id NOT IN (SELECT id FROM decisions ORDER BY decided_at DESC, id DESC LIMIT ?)`
    )
    .run(keep)
  return changes
}

export function runRetention(): MaintenanceReport {
  const report: MaintenanceReport = {
    examplesPruned: pruneExamples(getTaskStore(), KEEP_EXAMPLES),
    processedPruned: pruneProcessed(KEEP_PROCESSED_DAYS),
    decisionsPruned: pruneDecisions(KEEP_DECISIONS)
  }

  const total = report.examplesPruned + report.processedPruned + report.decisionsPruned
  if (total > 0) console.log('[maintenance] pruned', report)
  return report
}

/**
 * Brings stored vectors onto the current embedding convention.
 *
 * Mixing conventions in one store is worse than consistently using the older
 * one, because neighbours are then ranked across two slightly different spaces.
 * That makes this a repair rather than an improvement, and it has to finish —
 * so it runs in bounded batches every sweep until nothing is stale, and simply
 * gives up for now if the embedding model is unavailable.
 */
export async function backfillEmbeddings(model?: string): Promise<number> {
  if (isAiPaused(loadConfig().pauseAiUntil)) return 0
  const db = getTaskStore()
  const stale = staleEmbeddings(db, EMBED_VERSION, BACKFILL_BATCH)
  if (stale.length === 0) return 0

  let done = 0
  for (const row of stale) {
    try {
      // Embed exactly what will be stored, so the vector never describes text
      // that no longer exists. Rows written before the cap are shortened here.
      const text = truncateExample(row.message)
      const vector = await embed(text, model, 'document')
      replaceEmbedding(db, row.id, text, vector, EMBED_VERSION)
      done++
    } catch (err) {
      console.warn('[maintenance] re-embed paused:', (err as Error).message)
      break
    }
  }

  if (done > 0) console.log(`[maintenance] re-embedded ${done} example(s)`)
  return done
}
