import type { SpeechStatus } from './helperProtocol'
import type { ShortcutSet } from './shortcuts'

export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent'

export type TaskSource =
  | 'gmail'
  | 'gcalendar'
  /** Apple Calendar through EventKit: every account in Internet Accounts. */
  | 'acalendar'
  /** Created in Apple Reminders, on this Mac or another device. */
  | 'reminders'
  | 'outlook'
  | 'teams'
  | 'voice'
  /** Read off the screen by the capture shortcut or "what's on my screen". */
  | 'screen'
  /** Added or changed by asking in chat. */
  | 'chat'
  | 'manual'
  /** Materialised from a recurrence rule rather than observed anywhere. */
  | 'rule'

export type TaskStatus = 'pending' | 'done' | 'archived' | 'snoozed' | 'deleted' | 'suggested'

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
  /** Opens the thread or event the task came from. */
  sourceUrl: string | null
  /** The sentence that produced the task, quoted as-is. */
  evidence: string | null
}

export type Urgency = 'neutral' | 'approaching' | 'urgent' | 'overdue'

export type OverlayCorner = 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left'

export type ThemeChoice = 'system' | 'light' | 'dark'

export type AiEngine = 'apple' | 'ollama'
export type AiEnginePreference = 'auto' | AiEngine

export interface Config {
  overlayCorner: OverlayCorner
  overlayOpacity: number
  overlayWidth: number
  workHoursStart: number
  workHoursEnd: number
  syncIntervalMinutes: 5 | 15 | 30 | 60
  maxTasksVisible: number
  /** Automatic uses Apple's on-device model when this Mac has it, else Ollama. */
  aiEngine: AiEnginePreference
  /**
   * Mail tasks at or above this confidence, with a quote found in the message,
   * go straight onto the list. Null keeps every one a suggestion.
   */
  autoAcceptAbove: number | null
  ollamaModel: string
  embeddingModel: string
  /** Transformers.js model id for speech-to-text. */
  whisperModel: string
  /**
   * Start at sign-in. Off until the user turns it on: a login item is a
   * system change, not something to discover after the fact. The only
   * source of truth; the OS setting is written from it, never read back.
   */
  launchAtLogin: boolean
  /** Mirror recurring rules onto a Google Calendar this app creates. Opt-in: it writes to your account. */
  calendarWriteBack: boolean
  /** Meetings from Apple Calendar become prep tasks, like Google's. Mac only; asks for Calendar access. */
  appleCalendar: boolean
  /** Two-way sync with an "AmbientMind" list in Reminders. Opt-in: it writes to your iCloud. */
  remindersSync: boolean
  /** What the prompts should call the user. Empty falls back to the OS account. */
  displayName: string
  /**
   * Free text the user writes about their life, injected into prompts so the
   * model can tell what matters. Naming the user already measurably improved
   * extraction; this is the same lever, made explicit.
   */
  aboutMe: string
  /**
   * ISO timestamp until which extraction, chat and screen capture stay off.
   * Recurrence and snooze keep running. Null means not paused.
   */
  pauseAiUntil: string | null
  /**
   * The capture shortcut and "what's on my screen" read the front window.
   * Off until turned on: reading the screen should never be a surprise.
   */
  screenReading: boolean
  /** App names or bundle ids never read, on top of the built-in password managers. */
  excludedApps: string[]
  /** Hides AmbientMind's windows from screenshots, recordings and screen sharing. */
  contentProtection: boolean
  /** During a call or a full-screen app, the orb hides and notifications wait. */
  quietMode: boolean
  /** Settings and onboarding only; the overlay, capture and chat stay dark. */
  theme: ThemeChoice
  /** Only the shortcuts the user changed; the rest use the platform defaults. */
  shortcuts: Partial<ShortcutSet>
  /** Set when the welcome flow is finished; it opens at launch until then. */
  onboarded: boolean
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
  ai: {
    preference: AiEnginePreference
    /** What answers now; null when nothing can. */
    engine: AiEngine | null
    /** Null off the Mac or without the helper. */
    apple: { available: boolean; reason: string | null } | null
  }
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
  /** The user pressed Stop before an answer arrived. */
  stopped?: boolean
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
  aiEngine: 'auto',
  autoAcceptAbove: null,
  ollamaModel: 'qwen3:4b-instruct-2507-q4_K_M',
  embeddingModel: 'nomic-embed-text',
  whisperModel: 'Xenova/whisper-base.en',
  launchAtLogin: false,
  calendarWriteBack: false,
  appleCalendar: false,
  remindersSync: false,
  displayName: '',
  aboutMe: '',
  pauseAiUntil: null,
  screenReading: false,
  excludedApps: [],
  contentProtection: false,
  quietMode: true,
  theme: 'system',
  shortcuts: {},
  onboarded: false
}

/** Long enough for real context, short enough not to crowd out the message. */
export const ABOUT_ME_MAX_CHARS = 1200

/**
 * All CPU-bound, so this trades latency against accuracy — not VRAM against
 * the 3B model. Tiny is visibly weak on accented English.
 */
export interface SpeechEngineInfo {
  /** Apple streams words as you talk; Whisper transcribes afterwards. */
  engine: 'apple' | 'whisper'
  /** Apple's speech model on this Mac; null off the Mac or without the helper. */
  apple: SpeechStatus | null
  /** 0–1 while Apple's model downloads. */
  installing: number | null
}

export interface AppleSourceState {
  enabled: boolean
  access: 'granted' | 'denied' | 'restricted' | 'not-determined' | 'unknown'
  lastRun: string | null
  lastError: string | null
}

export interface AppleSourcesStatus {
  /** On a Mac with a helper that can reach Calendar and Reminders. */
  available: boolean
  calendar: AppleSourceState & { upcoming: number }
  reminders: AppleSourceState & { list: string | null; linked: number }
}

export const WHISPER_MODELS: { id: string; label: string }[] = [
  { id: 'Xenova/whisper-tiny.en', label: 'Tiny — fastest, least accurate (~75 MB)' },
  { id: 'Xenova/whisper-base.en', label: 'Base — recommended (~145 MB)' },
  { id: 'Xenova/whisper-small.en', label: 'Small — most accurate, slowest (~480 MB)' }
]
