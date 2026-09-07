import type { TaskPriority } from '@shared/types'
import { EXTRACTION_SCHEMA, buildExtractionPrompt } from '../../prompts/taskExtraction'
import { ENRICHMENT_SCHEMA, buildEnrichmentPrompt } from '../../prompts/taskEnrichment'

/**
 * Deliberately free of Electron imports so the evaluation harness can drive the
 * identical code path from plain Node.
 */

export const OLLAMA_URL = process.env.OLLAMA_URL ?? 'http://localhost:11434'

/** A 3B model on a 4GB GPU: generous, but bounded so a stall cannot wedge sync. */
const REQUEST_TIMEOUT_MS = 120_000

export class OllamaUnavailableError extends Error {
  constructor(cause?: unknown) {
    super(`Ollama is not reachable at ${OLLAMA_URL}`)
    this.name = 'OllamaUnavailableError'
    this.cause = cause
  }
}

export interface ExtractedTask {
  title: string
  deadline: string | null
  priority: TaskPriority
  people: string[]
  confidence: number
}

export interface MessageInput {
  sender: string
  recipients: string
  sentAt: string
  subject: string
  body: string
}

export interface ExtractOptions {
  model?: string
  userName?: string
  userEmail?: string
  fewShotExamples?: string
  /** Tasks scoring below this are treated as noise and dropped. */
  minConfidence?: number
  signal?: AbortSignal
}

const DEFAULTS = {
  model: 'qwen2.5:3b',
  userName: 'the user',
  userEmail: 'user@example.com',
  minConfidence: 0.6
}

async function post<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout

  let response: Response
  try {
    response = await fetch(`${OLLAMA_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: combined
    })
  } catch (err) {
    throw new OllamaUnavailableError(err)
  }

  if (!response.ok) {
    throw new Error(`Ollama ${path} responded ${response.status}: ${await response.text()}`)
  }
  return (await response.json()) as T
}

export async function isAvailable(): Promise<boolean> {
  try {
    const response = await fetch(`${OLLAMA_URL}/api/tags`, {
      signal: AbortSignal.timeout(2000)
    })
    return response.ok
  } catch {
    return false
  }
}

export async function listModels(): Promise<string[]> {
  const response = await fetch(`${OLLAMA_URL}/api/tags`)
  const data = (await response.json()) as { models?: { name: string }[] }
  return (data.models ?? []).map((model) => model.name)
}

const PRIORITIES: readonly TaskPriority[] = ['low', 'medium', 'high', 'urgent']

/**
 * Grammar-constrained decoding guarantees the shape but not the semantics, so
 * every field is still range-checked before it reaches the store.
 */
function sanitise(raw: unknown, minConfidence: number): ExtractedTask[] {
  const tasks = (raw as { tasks?: unknown })?.tasks
  if (!Array.isArray(tasks)) return []

  const cleaned: ExtractedTask[] = []
  for (const entry of tasks) {
    const task = entry as Partial<ExtractedTask>
    const title = typeof task.title === 'string' ? task.title.trim() : ''
    if (!title) continue

    const confidence =
      typeof task.confidence === 'number' && Number.isFinite(task.confidence)
        ? Math.min(1, Math.max(0, task.confidence))
        : 0
    if (confidence < minConfidence) continue

    const deadline =
      typeof task.deadline === 'string' && !Number.isNaN(Date.parse(task.deadline))
        ? new Date(task.deadline).toISOString()
        : null

    cleaned.push({
      title,
      deadline,
      priority: PRIORITIES.includes(task.priority as TaskPriority)
        ? (task.priority as TaskPriority)
        : 'medium',
      people: Array.isArray(task.people)
        ? task.people.filter((p): p is string => typeof p === 'string')
        : [],
      confidence
    })
  }
  return cleaned
}

export async function extractTasks(
  message: MessageInput,
  options: ExtractOptions = {}
): Promise<ExtractedTask[]> {
  const config = { ...DEFAULTS, ...options }
  const { system, user } = buildExtractionPrompt({
    userName: config.userName,
    userEmail: config.userEmail,
    fewShotExamples: options.fewShotExamples ? `${options.fewShotExamples}\n\n` : '',
    ...message
  })

  const data = await post<{ message?: { content?: string } }>(
    '/api/chat',
    {
      model: config.model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ],
      format: EXTRACTION_SCHEMA,
      stream: false,
      options: {
        // Extraction is a parsing task, not a creative one.
        temperature: 0,
        top_p: 0.9,
        num_ctx: 8192,
        num_predict: 800
      }
    },
    options.signal
  )

  const content = data.message?.content
  if (!content) return []

  try {
    return sanitise(JSON.parse(content), config.minConfidence)
  } catch {
    // Should be unreachable while `format` is set, but a schema rejection at the
    // server would otherwise surface as an unhandled parse error mid-sync.
    return []
  }
}

export interface EnrichedTask {
  title: string
  deadline: string | null
  priority: TaskPriority
  people: string[]
}

/**
 * Best-effort: quick-add must stay instant and must keep working with Ollama
 * stopped, so any failure falls back to the raw text the user typed.
 */
export async function enrichTask(
  input: string,
  options: { model?: string; signal?: AbortSignal } = {}
): Promise<EnrichedTask> {
  const fallback: EnrichedTask = { title: input.trim(), deadline: null, priority: 'medium', people: [] }

  try {
    const { system, user } = buildEnrichmentPrompt({
      input,
      currentTime: new Date().toISOString()
    })

    const data = await post<{ message?: { content?: string } }>(
      '/api/chat',
      {
        model: options.model ?? DEFAULTS.model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user }
        ],
        format: ENRICHMENT_SCHEMA,
        stream: false,
        options: { temperature: 0, num_ctx: 2048, num_predict: 200 }
      },
      options.signal
    )

    const parsed = JSON.parse(data.message?.content ?? '{}') as Partial<EnrichedTask>
    const title = typeof parsed.title === 'string' ? parsed.title.trim() : ''

    return {
      title: title || fallback.title,
      deadline:
        typeof parsed.deadline === 'string' && !Number.isNaN(Date.parse(parsed.deadline))
          ? new Date(parsed.deadline).toISOString()
          : null,
      priority: PRIORITIES.includes(parsed.priority as TaskPriority)
        ? (parsed.priority as TaskPriority)
        : 'medium',
      people: Array.isArray(parsed.people)
        ? parsed.people.filter((p): p is string => typeof p === 'string')
        : []
    }
  } catch {
    return fallback
  }
}

export async function embed(text: string, model = 'nomic-embed-text'): Promise<number[]> {
  const data = await post<{ embeddings?: number[][] }>('/api/embed', { model, input: text })
  const vector = data.embeddings?.[0]
  if (!vector) throw new Error('Ollama returned no embedding')
  return vector
}
