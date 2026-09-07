export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent'

export type TaskSource = 'gmail' | 'gcalendar' | 'outlook' | 'teams' | 'voice' | 'manual'

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
  embeddingModel: 'nomic-embed-text'
}
