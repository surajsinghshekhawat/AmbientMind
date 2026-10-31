/**
 * Deliberately free of Electron imports so the evaluation harness can drive the
 * identical code path from plain Node.
 */

export const OLLAMA_URL = process.env.OLLAMA_URL ?? 'http://localhost:11434'

/** A 3B model on a 4GB GPU: generous, but bounded so a stall cannot wedge sync. */
const REQUEST_TIMEOUT_MS = 120_000
/** Health polls this; a wedged server must read as down, not hang the banner. */
const TAGS_TIMEOUT_MS = 3_000

export class OllamaUnavailableError extends Error {
  constructor(cause?: unknown) {
    super(`Ollama is not reachable at ${OLLAMA_URL}`)
    this.name = 'OllamaUnavailableError'
    this.cause = cause
  }
}

const DEFAULT_MODEL = 'qwen2.5:3b'

async function post<T>(
  path: string,
  body: unknown,
  signal?: AbortSignal,
  timeoutMs = REQUEST_TIMEOUT_MS
): Promise<T> {
  const timeout = AbortSignal.timeout(timeoutMs)
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

export interface ChatOptions {
  system: string
  user: string
  model?: string
  /** JSON schema passed to Ollama's `format`, compiled to a decoding grammar. */
  format?: unknown
  numPredict?: number
  numCtx?: number
  signal?: AbortSignal
  timeoutMs?: number
}

/** Single grammar-constrained, deterministic chat call; the router in ai.ts decides when Ollama gets it. */
export async function chat(options: ChatOptions): Promise<string> {
  const data = await post<{ message?: { content?: string } }>(
    '/api/chat',
    {
      model: options.model ?? DEFAULT_MODEL,
      messages: [
        { role: 'system', content: options.system },
        { role: 'user', content: options.user }
      ],
      ...(options.format ? { format: options.format } : {}),
      stream: false,
      options: {
        temperature: 0,
        top_p: 0.9,
        num_ctx: options.numCtx ?? 8192,
        num_predict: options.numPredict ?? 800
      }
    },
    options.signal,
    options.timeoutMs
  )
  return data.message?.content ?? ''
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

export async function listModels(options: { timeoutMs?: number } = {}): Promise<string[]> {
  const response = await fetch(`${OLLAMA_URL}/api/tags`, {
    signal: AbortSignal.timeout(options.timeoutMs ?? TAGS_TIMEOUT_MS)
  })
  if (!response.ok) throw new Error(`Ollama /api/tags responded ${response.status}`)
  const data = (await response.json()) as { models?: { name: string }[] }
  return (data.models ?? []).map((model) => model.name)
}

/**
 * nomic-embed was trained with task prefixes and learned a deliberately
 * asymmetric geometry: a stored passage and a lookup of it are not meant to be
 * embedded the same way. Sending raw text for both is self-consistent, so
 * retrieval still ranks, but it uses the model outside its training
 * distribution and throws away that asymmetry.
 *
 * Applied only to nomic models. Every other embedding model treats these as
 * ordinary words and would be measurably worse for the addition.
 */
export type EmbedKind = 'document' | 'query'

const NOMIC_PREFIX: Record<EmbedKind, string> = {
  document: 'search_document: ',
  query: 'search_query: '
}

/**
 * Bumped when the convention changes, so stored vectors can be re-embedded.
 *
 *   1 — nomic task prefixes
 *   2 — example text capped, and the embedded string is the stored string
 *
 * Version 2 exists because version 1 rewrote vectors without rewriting the
 * text they came from, leaving rows whose vector described a longer string
 * than the one retained. Bumping is the cheap fix; that is the point of
 * recording a version rather than a boolean.
 */
export const EMBED_VERSION = 2

export function prefixFor(model: string, kind: EmbedKind): string {
  return /nomic/i.test(model) ? NOMIC_PREFIX[kind] : ''
}

export async function embed(
  text: string,
  model = 'nomic-embed-text',
  kind: EmbedKind = 'document'
): Promise<number[]> {
  const input = `${prefixFor(model, kind)}${text}`
  const data = await post<{ embeddings?: number[][] }>('/api/embed', { model, input })
  const vector = data.embeddings?.[0]
  if (!vector) throw new Error('Ollama returned no embedding')
  return vector
}
