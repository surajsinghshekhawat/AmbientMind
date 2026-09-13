export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent'

export type TaskSource =
  | 'gmail'
  | 'gcalendar'
  | 'outlook'
  | 'teams'
  | 'voice'
  | 'manual'
  /** Materialised from a recurrence rule rather than observed anywhere. */
  | 'rule'

export type TaskStatus = 'pending' | 'done' | 'archived' | 'snoozed'

/**
 * Deadlines cross the IPC boundary as ISO-8601 strings; structured clone would
 * survive `Date`, but SQLite and the model both speak ISO, so it stays a string
 * end to end and is only parsed where it is compared.
 */
export interface Task {
  id: string
  title: string
  deadline: string | null
  priority: TaskPriority
  source: TaskSource
  sourceId: string | null
  people: string[]
  rawContext: string | null
  confidence: number
  status: TaskStatus
  createdAt: string
  completedAt: string | null
  /** Set only while status is 'snoozed'; the sweep restores it to pending. */
  snoozedUntil: string | null
}

export type Urgency = 'neutral' | 'approaching' | 'urgent' | 'overdue'

export type OverlayCorner = 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left'

export interface Config {
  overlayCorner: OverlayCorner
  overlayOpacity: number
  overlayWidth: number
  workHoursStart: number
  workHoursEnd: number
  syncIntervalMinutes: 5 | 15 | 30 | 60
  maxTasksVisible: number
  ollamaModel: string
  embeddingModel: string
  /** Transformers.js model id for speech-to-text. */
  whisperModel: string
  /** Start with Windows. An assistant you have to remember to launch is one you stop using. */
  launchAtLogin: boolean
  /** Mirror recurring rules onto a Google Calendar this app creates. Opt-in: it writes to your account. */
  calendarWriteBack: boolean
  /** What the prompts should call the user. Empty falls back to the OS account. */
  displayName: string
  /**
   * Free text the user writes about their life, injected into prompts so the
   * model can tell what matters. Naming the user already measurably improved
   * extraction; this is the same lever, made explicit.
   */
  aboutMe: string
}

export interface ModelHealth {
  name: string
  role: 'extraction' | 'embedding'
  present: boolean
}

/** First-run diagnosis: why the list is empty, in the user's words. */
export interface HealthReport {
  checkedAt: string
  ollama: { running: boolean; url: string }
  models: ModelHealth[]
  google: { connected: boolean; credentialsConfigured: boolean }
  problems: string[]
  ok: boolean
}

/** A pattern the app noticed. Never acted on without an explicit yes. */
export interface RecurrenceSuggestion {
  id: string
  signature: string
  title: string
  weekdays: number[]
  time: string
  occurrences: number
  status: 'pending' | 'accepted' | 'dismissed'
  createdAt: string
}

export interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
}

export interface ChatReply {
  reply: string
  /** Changes actually made, in plain words, so the UI can show its work. */
  actions: string[]
  changed: boolean
}

export interface SyncSummary {
  lastRun: string | null
  lastError: string | null
  lastReport: {
    ranAt: string
    scanned: number
    added: number
    errors: string[]
  } | null
}

export const DEFAULT_CONFIG: Config = {
  overlayCorner: 'top-right',
  overlayOpacity: 0.92,
  overlayWidth: 380,
  workHoursStart: 9,
  workHoursEnd: 18,
  syncIntervalMinutes: 15,
  maxTasksVisible: 7,
  ollamaModel: 'qwen2.5:3b',
  embeddingModel: 'nomic-embed-text',
  whisperModel: 'Xenova/whisper-base.en',
  launchAtLogin: true,
  calendarWriteBack: false,
  displayName: '',
  aboutMe: ''
}

/** Long enough for real context, short enough not to crowd out the message. */
export const ABOUT_ME_MAX_CHARS = 1200

/**
 * All CPU-bound, so this trades latency against accuracy — not VRAM against
 * the 3B model. Tiny is visibly weak on accented English.
 */
export const WHISPER_MODELS: { id: string; label: string }[] = [
  { id: 'Xenova/whisper-tiny.en', label: 'Tiny — fastest, least accurate (~75 MB)' },
  { id: 'Xenova/whisper-base.en', label: 'Base — recommended (~145 MB)' },
  { id: 'Xenova/whisper-small.en', label: 'Small — most accurate, slowest (~480 MB)' }
]
