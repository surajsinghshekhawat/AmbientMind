import type { Task } from '@shared/types'
import { rejectDuplicates } from './dedup'
import { fetchUpcoming } from './integrations/gcalendar'
import { fetchMessage, listRecentMessageIds, shouldSkip } from './integrations/gmail'
import { connectedGoogleAccount, isGoogleConnected } from './googleAuth'
import {
  embed,
  extractTasks,
  isAvailable,
  OllamaUnavailableError,
  type ExtractedTask
} from './ollama'
import {
  addTasksIgnoringDuplicates,
  forgetRecentGmail,
  getSyncState,
  getTaskStore,
  isProcessed,
  listActive,
  markFailed,
  markProcessed,
  setSyncState,
  type NewTask
} from './taskStore'
import { exampleCount, nearestExamples, renderFewShot, storeExample } from './vectorStore'
import { suppressionFor } from './decisionStore'

export interface SyncReport {
  ranAt: string
  scanned: number
  skipped: number
  extracted: number
  added: number
  deduped: number
  /** Dropped because the user has repeatedly deleted this kind of task. */
  suppressed: number
  errors: string[]
}

export interface SyncOptions {
  model?: string
  embeddingModel?: string
  userName?: string
  userEmail?: string
  aboutMe?: string
  /** Re-read recent mail instead of skipping IDs already seen. Used by Sync now. */
  force?: boolean
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
  const userEmail = options.userEmail ?? connectedGoogleAccount() ?? 'me'
  const userName = options.userName ?? userEmail.split('@')[0] ?? 'the user'
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
      const { willRetry } = markFailed('gmail', id)
      report.errors.push(
        `gmail ${id}: ${(err as Error).message}${willRetry ? '' : ' (giving up on this message)'}`
      )
      continue
    }

    const reason = shouldSkip(fetched.message, fetched.payload)
    if (reason) {
      console.log(`[sync] skip "${fetched.message.subject}": ${reason}`)
      markProcessed('gmail', id, 'skipped')
      report.skipped++
      continue
    }

    options.onProgress?.(`Reading "${fetched.message.subject.slice(0, 60)}"`)
    budget--

    try {
      const fewShotExamples = await retrieveFewShot(fetched.message, options.embeddingModel)
      const extracted = await extractTasks(fetched.message, {
        model: options.model,
        userName,
        userEmail,
        ...(options.aboutMe ? { aboutMe: options.aboutMe } : {}),
        ...(fewShotExamples ? { fewShotExamples } : {})
      })
      console.log(
        `[sync] extract "${fetched.message.subject}" as ${userName}: ${extracted.length} task(s)`
      )
      report.extracted += extracted.length
      markProcessed('gmail', id, 'extracted', extracted.length)
      void rememberExtraction(fetched.message, extracted, options.embeddingModel)

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
      // Ollama going away mid-pass says nothing about this message or the ones
      // behind it. Charging every remaining mail an attempt would spend the
      // whole retry budget on a single restart, so the pass stops instead.
      if (err instanceof OllamaUnavailableError) {
        report.errors.push('Ollama stopped responding; the rest of this pass was left for later')
        break
      }
      const { willRetry } = markFailed('gmail', id)
      report.errors.push(
        `extract ${id}: ${(err as Error).message}${willRetry ? '' : ' (giving up on this message)'}`
      )
    }
  }

  void existing
  return candidates
}

function embeddingText(message: { subject: string; sender: string; body: string }) {
  return `Subject: ${message.subject}\nFrom: ${message.sender}\n\n${message.body}`
}

/**
 * Neighbours from this user's own extraction history. Empty store or a down
 * embed model both fall back to zero-shot — RAG must never block a sync.
 */
async function retrieveFewShot(
  message: { subject: string; sender: string; body: string },
  embedModel?: string
): Promise<string> {
  try {
    const db = getTaskStore()
    const available = exampleCount(db)
    if (available === 0) return ''
    const vector = await embed(embeddingText(message), embedModel)
    return renderFewShot(nearestExamples(db, vector, Math.min(5, available)))
  } catch (err) {
    console.warn('[rag] retrieve failed:', (err as Error).message)
    return ''
  }
}

async function rememberExtraction(
  message: { subject: string; sender: string; body: string },
  tasks: ExtractedTask[],
  embedModel?: string
) {
  try {
    const vector = await embed(embeddingText(message), embedModel)
    storeExample(getTaskStore(), embeddingText(message), tasks, vector, 'observed')
  } catch (err) {
    console.warn('[rag] store failed:', (err as Error).message)
  }
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
    suppressed: 0,
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
    if (options.force) {
      const forgotten = forgetRecentGmail(48)
      setSyncState('gcalendar', null)
      console.log(`[sync] force: reopened ${forgotten} gmail ids, calendar full resync`)
    }

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

    // Deleting the same thing three times without ever doing it is a
    // preference. Applied here rather than at extraction so the model stays
    // free of user-specific rules, and only to newly-arriving tasks: anything
    // already on the list was put there before the lesson was learned.
    const wanted = accepted.filter((task) => !suppressionFor(task.title).suppressed)
    report.suppressed = accepted.length - wanted.length
    report.added = addTasksIgnoringDuplicates(wanted).length

    setSyncState('gmail', null, report.errors.length > 0 ? report.errors[0]! : null)
    return report
  } finally {
    running = false
  }
}

let timer: NodeJS.Timeout | null = null

/**
 * `onReport` matters: without it a background pass writes tasks to the database
 * that the overlay never hears about, so new mail only appeared after the next
 * manual action.
 */
export function startScheduler(
  intervalMinutes: number,
  options: SyncOptions = {},
  onReport?: (report: SyncReport) => void
) {
  stopScheduler()
  const run = () => {
    void runSync(options)
      .then((report) => onReport?.(report))
      .catch(() => undefined)
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
