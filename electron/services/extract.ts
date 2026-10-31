import { z } from 'zod'
import { anchorToMessage, resolveDeadline } from '@shared/deadline'
import { resolveWhen } from '@shared/capture'
import { findEvidence, UNVERIFIED_CEILING, type Evidence } from '@shared/evidence'
import { formatPromptTime } from '@shared/promptTime'
import type { AiEngine, TaskPriority } from '@shared/types'
import { EXTRACTION_SCHEMA, buildExtractionPrompt } from '../../prompts/taskExtraction'
import { ENRICHMENT_SCHEMA, buildEnrichmentPrompt } from '../../prompts/taskEnrichment'
import { aiPreference, AiUnavailableError, appleTextBudget, chooseEngine, fitsApple, generate } from './ai'
import { isAvailable as ollamaAvailable } from './ollama'

/**
 * Deliberately free of Electron imports so the evaluation harness can drive the
 * identical code path from plain Node.
 */

export interface ExtractedTask {
  title: string
  deadline: string | null
  priority: TaskPriority
  people: string[]
  confidence: number
  /** Verbatim text from the message supporting the task. */
  evidence: string | null
  /** The model's own quote was found in the message, rather than one found for it. */
  verified?: boolean
}

export interface MessageInput {
  sender: string
  recipients: string
  sentAt: string
  subject: string
  body: string
}

export interface ExtractOptions {
  userName?: string
  userEmail?: string
  aboutMe?: string
  fewShotExamples?: string
  /** Tasks scoring below this are treated as noise and dropped. */
  minConfidence?: number
  signal?: AbortSignal
  engine?: AiEngine
}

const DEFAULTS = {
  userName: 'the user',
  userEmail: 'user@example.com',
  minConfidence: 0.6
}

const EXTRACT_TOKENS = 800
/** Quick Add shows the raw text at once; a slower answer is not worth waiting for. */
const ENRICH_TIMEOUT_MS = 30_000

const PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const

/**
 * The schema fixes the shape for Ollama and Apple alike, but not the meaning:
 * Apple leaves out null fields, and either can return a number out of range.
 * Each task is checked on its own so one bad entry doesn't lose the rest.
 */
const RawTask = z.object({
  title: z.string().trim().min(1),
  deadline: z.string().nullish(),
  priority: z.string().nullish(),
  people: z.array(z.string()).nullish(),
  confidence: z.number().finite().nullish(),
  evidence: z.string().nullish()
})

const RawExtraction = z.object({ asksUser: z.boolean().nullish(), tasks: z.array(z.unknown()) })

const RawEnrichment = z.object({
  title: z.string().nullish(),
  deadline: z.string().nullish(),
  priority: z.string().nullish(),
  people: z.array(z.string()).nullish()
})

/** Models sometimes answer "no task" with a task saying so. */
const NOT_A_TASK = /^(?:no (?:action|task|follow[- ]?up)s?(?: (?:is )?(?:required|needed))?|none|n\/?a|nothing(?: to do)?)\.?$/i

function priorityOf(value: string | null | undefined): TaskPriority {
  return PRIORITIES.includes(value as TaskPriority) ? (value as TaskPriority) : 'medium'
}

/**
 * The quote usually holds the deadline words ("send them over by EOD
 * tomorrow"), and code resolves those against the message date more reliably
 * than models do. Only when the model gave a deadline too, so a quote that
 * merely mentions a day doesn't invent one.
 */
function deadlineFor(raw: string | null | undefined, evidence: Evidence, anchor: Date, sent: Date): string | null {
  const stated = anchorToMessage(resolveDeadline(raw, anchor), sent)
  if (!stated || !evidence.quote) return stated
  return resolveWhen(evidence.quote, anchor) ?? stated
}

/** `sentAt` anchors relative and wrong-year deadlines to the message, not to today. */
export function parseExtraction(
  content: string,
  source: string,
  minConfidence: number,
  sentAt?: string
): ExtractedTask[] {
  const sent = sentAt ? new Date(sentAt) : new Date(Number.NaN)
  const anchor = Number.isNaN(sent.getTime()) ? new Date() : sent
  let json: unknown
  try {
    json = JSON.parse(content)
  } catch (err) {
    // Unreachable while the schema holds, but a server-side rejection would
    // otherwise surface as an unhandled parse error mid-sync.
    console.warn('[extract] JSON rejected:', (err as Error).message)
    return []
  }
  const parsed = RawExtraction.safeParse(json)
  // The model's own verdict that nothing is asked outranks the tasks it wrote anyway.
  if (!parsed.success || parsed.data.asksUser === false) return []

  const tasks: ExtractedTask[] = []
  for (const entry of parsed.data.tasks) {
    const task = RawTask.safeParse(entry)
    if (!task.success || NOT_A_TASK.test(task.data.title)) continue
    const confidence = Math.min(1, Math.max(0, task.data.confidence ?? 0))
    if (confidence < minConfidence) continue
    const evidence = findEvidence(task.data.evidence, source, task.data.title)
    // Nothing in the message supports it: the model made it up.
    if (!evidence.quote) continue
    tasks.push({
      title: task.data.title,
      deadline: deadlineFor(task.data.deadline, evidence, anchor, sent),
      priority: priorityOf(task.data.priority),
      people: task.data.people ?? [],
      confidence: evidence.verified ? confidence : Math.min(confidence, UNVERIFIED_CEILING),
      evidence: evidence.quote,
      verified: evidence.verified
    })
  }
  return tasks
}

export async function extractTasks(message: MessageInput, options: ExtractOptions = {}): Promise<ExtractedTask[]> {
  const config = { ...DEFAULTS, ...options }
  const build = (body: string, fewShot: string) =>
    buildExtractionPrompt({
      userName: config.userName,
      userEmail: config.userEmail,
      ...(options.aboutMe ? { aboutMe: options.aboutMe } : {}),
      fewShotExamples: fewShot ? `${fewShot}\n\n` : '',
      // The message date is passed through as-is. Naming the weekday here was
      // tried and measured: it did not improve extraction and appeared to cost
      // deadline accuracy, so the extractor keeps the raw header. The weekday
      // treatment is reserved for "now" in the quick-add and screen prompts,
      // where there is no message body competing for attention.
      ...message,
      body
    })

  let engine = options.engine ?? (await chooseEngine())
  if (!engine) throw new AiUnavailableError('No AI is available to read mail')

  let prompt = build(message.body, options.fewShotExamples ?? '')
  // Apple's window is about 4K tokens. Examples go first; a message still too
  // long goes to Ollama whole when it can, and is cut to fit only when not.
  if (engine === 'apple' && !fitsApple(prompt.system, prompt.user, EXTRACTION_SCHEMA, EXTRACT_TOKENS)) {
    prompt = build(message.body, '')
    if (!fitsApple(prompt.system, prompt.user, EXTRACTION_SCHEMA, EXTRACT_TOKENS)) {
      if (!options.engine && aiPreference() === 'auto' && (await ollamaAvailable())) {
        engine = 'ollama'
        prompt = build(message.body, options.fewShotExamples ?? '')
      } else {
        const empty = build('', '')
        const budget = appleTextBudget(empty.system + empty.user, EXTRACTION_SCHEMA, EXTRACT_TOKENS)
        prompt = build(`${message.body.slice(0, budget)}…`, '')
      }
    }
  }

  const result = await generate({
    purpose: 'extract',
    engine,
    system: prompt.system,
    user: prompt.user,
    schema: EXTRACTION_SCHEMA,
    maxTokens: EXTRACT_TOKENS,
    numCtx: 8192,
    ...(options.signal ? { signal: options.signal } : {})
  })
  return parseExtraction(result.content, `${message.subject}\n\n${message.body}`, config.minConfidence, message.sentAt)
}

export interface EnrichedTask {
  title: string
  deadline: string | null
  priority: TaskPriority
  people: string[]
}

/**
 * Best-effort: quick-add must stay instant and must keep working with no model
 * at all, so any failure falls back to the raw text the user typed.
 */
export async function enrichTask(
  input: string,
  options: { signal?: AbortSignal; timeoutMs?: number; engine?: AiEngine } = {}
): Promise<EnrichedTask> {
  const fallback: EnrichedTask = { title: input.trim(), deadline: null, priority: 'medium', people: [] }
  try {
    const { system, user } = buildEnrichmentPrompt({ input, currentTime: formatPromptTime() })
    const result = await generate({
      purpose: 'enrich',
      system,
      user,
      schema: ENRICHMENT_SCHEMA,
      maxTokens: 200,
      numCtx: 2048,
      timeoutMs: options.timeoutMs ?? ENRICH_TIMEOUT_MS,
      ...(options.engine ? { engine: options.engine } : {}),
      ...(options.signal ? { signal: options.signal } : {})
    })
    const parsed = RawEnrichment.safeParse(JSON.parse(result.content || '{}'))
    if (!parsed.success) return fallback
    return {
      title: parsed.data.title?.trim() || fallback.title,
      deadline: resolveDeadline(parsed.data.deadline),
      priority: priorityOf(parsed.data.priority),
      people: parsed.data.people ?? []
    }
  } catch (err) {
    console.warn('[extract] enrichment failed:', (err as Error).message)
    return fallback
  }
}
