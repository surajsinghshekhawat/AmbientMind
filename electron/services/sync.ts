import type { Task } from '@shared/types'
import { rejectDuplicates } from './dedup'
import { fetchUpcoming } from './integrations/gcalendar'
import { fetchMessage, listRecentMessageIds, shouldSkip } from './integrations/gmail'
import { connectedGoogleAccount, isGoogleConnected } from './googleAuth'
import { extractTasks, isAvailable } from './ollama'
import {
  addTasksIgnoringDuplicates,
  getSyncState,
  isProcessed,
  listActive,
  markProcessed,
  setSyncState,
  type NewTask
} from './taskStore'

export interface SyncReport {
  ranAt: string
  scanned: number
  skipped: number
  extracted: number
  added: number
  deduped: number
  errors: string[]
}

export interface SyncOptions {
  model?: string
  /** Ceiling on model calls per pass, so one busy morning cannot peg the GPU. */
  maxExtractionsPerRun?: number
  onProgress?: (message: string) => void
}

const DEFAULT_MAX_EXTRACTIONS = 15

let running = false

/**
 * Extraction is serialised deliberately. The model holds ~2GB of VRAM on a 4GB
 * card, so concurrent generations would thrash rather than parallelise, and the
 * app is supposed to be invisible while it works.
 */
async function syncGmail(
  report: SyncReport,
  existing: Task[],
  options: Required<Pick<SyncOptions, 'model' | 'maxExtractionsPerRun'>> & SyncOptions
): Promise<NewTask[]> {
  const userEmail = connectedGoogleAccount() ?? 'me'
  const userName = userEmail.split('@')[0] ?? 'the user'
  const candidates: NewTask[] = []
  let budget = options.maxExtractionsPerRun

  const ids = await listRecentMessageIds()
  report.scanned += ids.length

  for (const { id } of ids) {
    if (budget <= 0) break
    if (isProcessed('gmail', id)) continue

    let fetched
    try {
      fetched = await fetchMessage(id)
    } catch (err) {
      markProcessed('gmail', id, 'failed')
      report.errors.push(`gmail ${id}: ${(err as Error).message}`)
      continue
    }

    const reason = shouldSkip(fetched.message, fetched.payload)
    if (reason) {
      markProcessed('gmail', id, 'skipped')
      report.skipped++
      continue
    }

    options.onProgress?.(`Reading "${fetched.message.subject.slice(0, 60)}"`)
    budget--

    try {
      const extracted = await extractTasks(fetched.message, {
        model: options.model,
        userName,
        userEmail
      })
      report.extracted += extracted.length
      markProcessed('gmail', id, 'extracted', extracted.length)

      for (const task of extracted) {
        candidates.push({
          title: task.title,
          deadline: task.deadline,
          priority: task.priority,
          source: 'gmail',
          // Ties the task back to the message so the same mail can never
          // produce it twice, even across app restarts.
          sourceId: `${id}:${task.title.slice(0, 40)}`,
          people: task.people,
          rawContext: `${fetched.message.subject}\n\n${fetched.message.body.slice(0, 2000)}`,
          confidence: task.confidence
        })
      }
    } catch (err) {
      markProcessed('gmail', id, 'failed')
      report.errors.push(`extract ${id}: ${(err as Error).message}`)
    }
  }

  void existing
  return candidates
}

async function syncCalendar(report: SyncReport): Promise<NewTask[]> {
  const { cursor } = getSyncState('gcalendar')
  try {
    const { tasks, nextSyncToken } = await fetchUpcoming(cursor)
    setSyncState('gcalendar', nextSyncToken)
    report.scanned += tasks.length
    return tasks
  } catch (err) {
    setSyncState('gcalendar', cursor, (err as Error).message)
    report.errors.push(`calendar: ${(err as Error).message}`)
    return []
  }
}

export async function runSync(options: SyncOptions = {}): Promise<SyncReport> {
  const report: SyncReport = {
    ranAt: new Date().toISOString(),
    scanned: 0,
    skipped: 0,
    extracted: 0,
    added: 0,
    deduped: 0,
    errors: []
  }

  // A slow pass must never overlap the next tick and double the model load.
  if (running) {
    report.errors.push('a sync is already in progress')
    return report
  }
  if (!isGoogleConnected()) {
    report.errors.push('Google account is not connected')
    return report
  }
  if (!(await isAvailable())) {
    report.errors.push('Ollama is not running; skipping this pass')
    return report
  }

  running = true
  try {
    const resolved = {
      model: options.model ?? 'qwen2.5:3b',
      maxExtractionsPerRun: options.maxExtractionsPerRun ?? DEFAULT_MAX_EXTRACTIONS,
      ...options
    }

    const existing = listActive()
    const candidates = [
      ...(await syncCalendar(report)),
      ...(await syncGmail(report, existing, resolved))
    ]

    const { accepted, rejected } = rejectDuplicates(candidates, existing)
    report.deduped = rejected.length
    report.added = addTasksIgnoringDuplicates(accepted).length

    setSyncState('gmail', null, report.errors.length > 0 ? report.errors[0]! : null)
    return report
  } finally {
    running = false
  }
}

let timer: NodeJS.Timeout | null = null

export function startScheduler(intervalMinutes: number, options: SyncOptions = {}) {
  stopScheduler()
  const run = () => {
    void runSync(options).catch(() => undefined)
  }
  // Delayed rather than immediate: login is the worst possible moment to load a
  // 2GB model, since the user is still waiting for the desktop to settle.
  timer = setTimeout(() => {
    run()
    timer = setInterval(run, intervalMinutes * 60_000)
  }, 60_000)
}

export function stopScheduler() {
  if (timer) clearTimeout(timer)
  if (timer) clearInterval(timer)
  timer = null
}
