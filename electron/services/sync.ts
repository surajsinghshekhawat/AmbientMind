import { describePause, isAiPaused } from '@shared/pauseAi'
import type { Task } from '@shared/types'
import { rejectDuplicates } from './dedup'
import { fetchPrepTasks } from './integrations/gcalendar'
import { fetchMessage, listRecentMessageIds, shouldSkip } from './integrations/gmail'
import { connectedGoogleAccount, GOOGLE_SCOPES_MESSAGE, isGoogleConnected, isScopeError } from './googleAuth'
import { shouldAutoAccept } from '@shared/evidence'
import { AiUnavailableError, chooseEngine } from './ai'
import { extractTasks, type ExtractedTask } from './extract'
import { embed, EMBED_VERSION } from './ollama'
import {
  addTasksIgnoringDuplicates,
  forgetRecentGmail,
  getTaskStore,
  isProcessed,
  listActive,
  listRetryableFailures,
  markFailed,
  markProcessed,
  reconcileCalendarTasks,
  setSyncState,
  type NewTask
} from './taskStore'
import {
  exampleCount,
  nearestExamples,
  renderFewShot,
  storeExample,
  truncateExample
} from './vectorStore'
import { suppressionFor } from './decisionStore'
import { loadConfig } from './config'

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
  embeddingModel?: string
  userName?: string
  userEmail?: string
  aboutMe?: string
  /** Re-read recent mail instead of skipping IDs already seen. Used by Sync now. */
  force?: boolean
  /** Confidence at which a mail task skips the suggestion step; null keeps all as suggestions. */
  autoAcceptAbove?: number | null
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
  options: Required<Pick<SyncOptions, 'maxExtractionsPerRun'>> & SyncOptions
): Promise<NewTask[]> {
  const userEmail = options.userEmail ?? connectedGoogleAccount() ?? 'me'
  const userName = options.userName ?? userEmail.split('@')[0] ?? 'the user'
  const candidates: NewTask[] = []
  let budget = options.maxExtractionsPerRun

  // Retries first: a message that failed during a long outage has already
  // fallen out of the recent listing, so waiting for it to reappear there
  // would mean it never came back at all.
  const recent = await listRecentMessageIds()
  const seen = new Set(recent.map((message) => message.id))
  const ids = [
    ...listRetryableFailures('gmail').filter((id) => !seen.has(id)),
    ...recent.map((message) => message.id)
  ]
  report.scanned += ids.length

  for (const id of ids) {
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
          sourceUrl: `https://mail.google.com/mail/u/0/#all/${id}`,
          people: task.people,
          rawContext: `${fetched.message.subject}\n\n${fetched.message.body.slice(0, 2000)}`,
          confidence: task.confidence,
          evidence: task.evidence,
          // A model's reading of someone else's mail is a suggestion until
          // the user says yes, unless they chose to trust confident ones.
          status: shouldAutoAccept(task.confidence, task.verified ?? false, options.autoAcceptAbove ?? null)
            ? 'pending'
            : 'suggested'
        })
      }
    } catch (err) {
      // The model going away mid-pass says nothing about this message or the
      // ones behind it. Charging every remaining mail an attempt would spend
      // the whole retry budget on a single restart, so the pass stops instead.
      if (err instanceof AiUnavailableError) {
        report.errors.push('The AI model stopped responding; the rest of this pass was left for later')
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

/**
 * The same string is both stored and embedded, so a vector always describes
 * text that still exists and can be reproduced exactly during a re-embed. The
 * cap lives in vectorStore because the backfill applies it too.
 */
function embeddingText(message: { subject: string; sender: string; body: string }) {
  return truncateExample(`Subject: ${message.subject}\nFrom: ${message.sender}\n\n${message.body}`)
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
    const vector = await embed(embeddingText(message), embedModel, 'query')
    return renderFewShot(nearestExamples(db, vector, Math.min(5, available)))
  } catch (err) {
    console.warn('[rag] retrieve failed:', (err as Error).message)
    return ''
  }
}

async function rememberExtraction(
  message: { id: string; subject: string; sender: string; body: string },
  tasks: ExtractedTask[],
  embedModel?: string
) {
  try {
    const text = embeddingText(message)
    const vector = await embed(text, embedModel, 'document')
    // Stored as the model writes them, so examples teach the output shape.
    const shown = tasks.map(({ verified: _verified, ...task }) => task)
    storeExample(getTaskStore(), text, shown, vector, {
      source: 'observed',
      // Lets a task rate the example it came from once the user acts on it.
      sourceId: message.id,
      embedVersion: EMBED_VERSION
    })
  } catch (err) {
    console.warn('[rag] store failed:', (err as Error).message)
  }
}

/** Updates and removes existing prep tasks; returns only meetings not yet on the list. */
async function syncCalendar(report: SyncReport): Promise<NewTask[]> {
  try {
    const { tasks: prep, uids } = await fetchPrepTasks()
    const { fresh, updated, removed, archived } = reconcileCalendarTasks('gcalendar', prep)
    if (updated + removed + archived > 0) {
      console.log('[sync] calendar reconciled', { updated, removed, archived })
    }
    // Kept as the cursor so the Apple Calendar pass can skip Google's events.
    setSyncState('gcalendar', JSON.stringify(uids))
    report.scanned += prep.length
    return fresh
  } catch (err) {
    const message = isScopeError((err as Error).message) ? GOOGLE_SCOPES_MESSAGE : (err as Error).message
    setSyncState('gcalendar', null, message)
    report.errors.push(named('calendar', message))
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
  const pausedUntil = loadConfig().pauseAiUntil
  if (isAiPaused(pausedUntil) && pausedUntil) {
    report.errors.push(describePause(pausedUntil))
    return report
  }
  if (!isGoogleConnected()) {
    report.errors.push('Google account is not connected')
    recordMailOutcome(report)
    return report
  }

  running = true
  try {
    if (options.force) {
      const forgotten = forgetRecentGmail(48)
      console.log(`[sync] force: reopened ${forgotten} gmail ids`)
    }

    const resolved = {
      maxExtractionsPerRun: options.maxExtractionsPerRun ?? DEFAULT_MAX_EXTRACTIONS,
      ...options
    }

    const existing = listActive()
    // Calendar import is deterministic and needs no model, so it runs even
    // when no model is available; only mail waits for one.
    const candidates = await syncCalendar(report)
    if (await chooseEngine()) {
      try {
        candidates.push(...(await syncGmail(report, existing, resolved)))
      } catch (err) {
        report.errors.push(named('gmail', isScopeError((err as Error).message) ? GOOGLE_SCOPES_MESSAGE : (err as Error).message))
      }
    } else {
      report.errors.push('No AI model is available (Apple Intelligence off, Ollama not running); mail was not read this pass')
    }

    const { accepted, rejected } = rejectDuplicates(candidates, existing)
    report.deduped = rejected.length

    // Deleting the same thing three times without ever doing it is a
    // preference. Applied here rather than at extraction so the model stays
    // free of user-specific rules, and only to newly-arriving tasks: anything
    // already on the list was put there before the lesson was learned.
    const wanted = accepted.filter((task) => !suppressionFor(task.title).suppressed)
    report.suppressed = accepted.length - wanted.length
    report.added = addTasksIgnoringDuplicates(wanted).length
  } catch (err) {
    // Callers show a spinner until this resolves; a throw would leave it
    // spinning and the failure unrecorded.
    report.errors.push(`sync: ${(err as Error).message}`)
  } finally {
    running = false
  }
  recordMailOutcome(report)
  return report
}

/** "calendar: Calendar 404: …" says the source twice. */
function named(source: 'gmail' | 'calendar', message: string): string {
  return message.toLowerCase().startsWith(source) ? message : `${source}: ${message}`
}

/** Calendar records its own outcome; everything else is the mail pass's. */
function recordMailOutcome(report: SyncReport) {
  try {
    setSyncState('gmail', null, report.errors.find((e) => !/^calendar\b/i.test(e)) ?? null)
  } catch (err) {
    console.warn('[sync] could not record outcome:', (err as Error).message)
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
  /** Called on every run, so profile and model changes apply without a restart. */
  getOptions: () => SyncOptions,
  onReport?: (report: SyncReport) => void
) {
  stopScheduler()
  const run = () => {
    let options: SyncOptions
    try {
      options = getOptions()
    } catch (err) {
      console.warn('[sync] could not read options:', (err as Error).message)
      return
    }
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
