import type { TaskPriority } from '../shared/types'

export interface GoldTask {
  title: string
  deadline: string | null
  priority: TaskPriority
}

/** One JSONL record per message in the labelled corpus. */
export interface LabelledMessage {
  id: string
  sender: string
  recipients: string
  sentAt: string
  subject: string
  body: string
  /** Empty array is a meaningful label: "this message contains no task". */
  goldTasks: GoldTask[]
  notes?: string
}

export interface Metrics {
  truePositives: number
  falsePositives: number
  falseNegatives: number
  precision: number
  recall: number
  f1: number
  /** Share of task-free messages the model correctly left alone. */
  emptySpecificity: number
  /** Of matched pairs, the share whose deadline lands on the right calendar day. */
  deadlineAccuracy: number
  messagesScored: number
}
