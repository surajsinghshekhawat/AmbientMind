import type { AppleGenerate, AppleModelStatus } from '@shared/helperProtocol'
import type { AiEngine, AiEnginePreference } from '@shared/types'
import { chat as ollamaChat, isAvailable as ollamaAvailable, OllamaUnavailableError } from './ollama'

/**
 * Picks the model for each call: Apple's on-device model when this Mac has it,
 * otherwise Ollama. Free of Electron imports so the evaluation harness drives
 * the same path; the app plugs Apple in through the helper, the harness
 * through its own helper process.
 */

export type AiPurpose = 'extract' | 'enrich' | 'chat' | 'screen'

export interface AppleBackend {
  status(): Promise<AppleModelStatus>
  generate(params: AppleGenerate, timeoutMs: number): Promise<{ content: string; ms: number }>
}

export interface GenerateRequest {
  purpose: AiPurpose
  system: string
  user: string
  /** JSON Schema; Ollama compiles it to a grammar, Apple to a generation schema. */
  schema?: unknown
  maxTokens?: number
  /** Ollama only: Apple's window is fixed. */
  numCtx?: number
  signal?: AbortSignal
  timeoutMs?: number
  /** Skips the choice, e.g. for the benchmark. */
  engine?: AiEngine
}

export interface GenerateResult {
  content: string
  engine: AiEngine
  model: string
  ms: number
}

export interface AiCall {
  at: string
  purpose: AiPurpose
  engine: AiEngine
  model: string
  ms: number
  promptChars: number
  ok: boolean
  error?: string
  /** Apple declined or overflowed and Ollama answered instead. */
  fellBack?: boolean
}

export class AiUnavailableError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message)
    this.name = 'AiUnavailableError'
    this.cause = cause
  }
}

export const APPLE_MODEL = 'apple-on-device'
const DEFAULT_TIMEOUT_MS = 120_000
/** Rough and deliberately pessimistic: Apple's tokenizer averages nearer 4 characters. */
const CHARS_PER_TOKEN = 3.2
/** Instructions, schema and framing the model adds around our text. */
const APPLE_OVERHEAD_TOKENS = 250
const STATUS_TTL_MS = 60_000
/** A helper still starting answers nothing; ask again soon rather than in a minute. */
const MISSING_STATUS_TTL_MS = 5_000

/** Apple failures that say nothing about Ollama, so Ollama gets the call. */
const FALLBACK_CODES = new Set([
  'context_overflow',
  'guardrail',
  'refusal',
  'unsupported_language',
  'unavailable',
  'bad_schema',
  'generation_failed',
  'busy',
  'timeout'
])

interface State {
  apple: AppleBackend | null
  preference: AiEnginePreference
  ollamaModel: string
  onCall: ((call: AiCall) => void) | null
}

const state: State = { apple: null, preference: 'auto', ollamaModel: 'qwen3:4b-instruct-2507-q4_K_M', onCall: null }
let appleStatus: { at: number; value: AppleModelStatus | null } | null = null

export function configureAi(next: Partial<State>): void {
  if ('apple' in next) appleStatus = null
  Object.assign(state, next)
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN)
}

/** Whether a prompt leaves room for the answer in Apple's window. */
export function fitsApple(system: string, user: string, schema: unknown, maxTokens: number, contextTokens = 4096): boolean {
  const schemaTokens = schema ? estimateTokens(JSON.stringify(schema)) : 0
  return estimateTokens(system) + estimateTokens(user) + schemaTokens + APPLE_OVERHEAD_TOKENS + maxTokens <= contextTokens
}

/** Characters of free text (a message, a screen) that fit beside a fixed prompt in Apple's window. */
export function appleTextBudget(fixed: string, schema: unknown, maxTokens: number, contextTokens = 4096): number {
  const schemaTokens = schema ? estimateTokens(JSON.stringify(schema)) : 0
  const spare = contextTokens - estimateTokens(fixed) - schemaTokens - APPLE_OVERHEAD_TOKENS - maxTokens
  return Math.max(0, Math.floor(spare * CHARS_PER_TOKEN))
}

export async function appleModelStatus(fresh = false): Promise<AppleModelStatus | null> {
  if (!state.apple) return null
  const ttl = appleStatus?.value ? STATUS_TTL_MS : MISSING_STATUS_TTL_MS
  if (!fresh && appleStatus && Date.now() - appleStatus.at < ttl) return appleStatus.value
  let value: AppleModelStatus | null
  try {
    value = await state.apple.status()
  } catch {
    value = null
  }
  appleStatus = { at: Date.now(), value }
  return value
}

/** The engine a call would use now, or null when neither can answer. */
/**
 * Chat plans changes against a whole task list, where Apple's model trailed
 * both Ollama candidates on `eval:chat` (14/18 against 16 and 17). Automatic
 * gives chat to Ollama while it is running.
 */
const OLLAMA_FIRST: ReadonlySet<AiPurpose> = new Set(['chat'])

export async function chooseEngine(purpose?: AiPurpose): Promise<AiEngine | null> {
  if (state.preference === 'auto' && purpose && OLLAMA_FIRST.has(purpose) && (await ollamaAvailable())) return 'ollama'
  if (state.preference !== 'ollama' && (await appleModelStatus())?.available) return 'apple'
  if (state.preference !== 'apple' && (await ollamaAvailable())) return 'ollama'
  return null
}

export function aiPreference(): AiEnginePreference {
  return state.preference
}

function record(call: AiCall) {
  try {
    state.onCall?.(call)
  } catch {
    // A broken log must never fail the call it describes.
  }
}

async function viaOllama(request: GenerateRequest): Promise<string> {
  try {
    return await ollamaChat({
      system: request.system,
      user: request.user,
      model: state.ollamaModel,
      ...(request.schema ? { format: request.schema } : {}),
      ...(request.maxTokens ? { numPredict: request.maxTokens } : {}),
      ...(request.numCtx ? { numCtx: request.numCtx } : {}),
      ...(request.signal ? { signal: request.signal } : {}),
      timeoutMs: request.timeoutMs ?? DEFAULT_TIMEOUT_MS
    })
  } catch (err) {
    if (err instanceof OllamaUnavailableError) throw new AiUnavailableError(err.message, err)
    throw err
  }
}

async function viaApple(request: GenerateRequest): Promise<string> {
  const result = await state.apple!.generate(
    {
      system: request.system,
      prompt: request.user,
      ...(request.schema ? { schema: request.schema } : {}),
      ...(request.maxTokens ? { maxTokens: request.maxTokens } : {})
    },
    request.timeoutMs ?? DEFAULT_TIMEOUT_MS
  )
  return result.content
}

export async function generate(request: GenerateRequest): Promise<GenerateResult> {
  let engine = request.engine ?? (await chooseEngine(request.purpose))
  if (!engine) {
    throw new AiUnavailableError(
      state.preference === 'apple'
        ? 'Apple Intelligence is not available on this Mac'
        : 'No AI is available: Apple Intelligence is off and Ollama is not running'
    )
  }
  const promptChars = request.system.length + request.user.length
  const canFallBack = !request.engine && state.preference === 'auto'
  let fellBack = false

  // Too long for Apple's window: Ollama when allowed, so the message is read
  // whole rather than cut down to fit.
  if (engine === 'apple' && canFallBack) {
    const contextTokens = (await appleModelStatus())?.contextTokens ?? 4096
    if (!fitsApple(request.system, request.user, request.schema, request.maxTokens ?? 800, contextTokens) && (await ollamaAvailable())) {
      engine = 'ollama'
      fellBack = true
    }
  }

  const started = Date.now()
  const model = engine === 'apple' ? APPLE_MODEL : state.ollamaModel
  try {
    const content = engine === 'apple' ? await viaApple(request) : await viaOllama(request)
    const result = { content, engine, model, ms: Date.now() - started }
    record({ at: new Date(started).toISOString(), purpose: request.purpose, engine, model, ms: result.ms, promptChars, ok: true, ...(fellBack ? { fellBack } : {}) })
    return result
  } catch (err) {
    const code = (err as { code?: string }).code
    record({
      at: new Date(started).toISOString(),
      purpose: request.purpose,
      engine,
      model,
      ms: Date.now() - started,
      promptChars,
      ok: false,
      error: code ?? (err as Error).message
    })
    if (engine === 'apple' && canFallBack && code && FALLBACK_CODES.has(code) && !request.signal?.aborted && (await ollamaAvailable())) {
      const retryStarted = Date.now()
      const content = await viaOllama(request)
      const ms = Date.now() - retryStarted
      record({ at: new Date(retryStarted).toISOString(), purpose: request.purpose, engine: 'ollama', model: state.ollamaModel, ms, promptChars, ok: true, fellBack: true })
      return { content, engine: 'ollama', model: state.ollamaModel, ms }
    }
    if (engine === 'apple' && code === 'unavailable') appleStatus = null
    throw err
  }
}
