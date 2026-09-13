import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '@shared/ipc'
import type {
  ChatReply,
  ChatTurn,
  Config,
  HealthReport,
  RecurrenceSuggestion,
  SyncSummary,
  Task
} from '@shared/types'
import type { NewRecurrenceRule, RecurrenceRule } from '@shared/recurrence'

const api = {
  setMouseCapture: (capture: boolean) => ipcRenderer.send(IPC.SetMouseCapture, capture),
  setOverlayExpanded: (expanded: boolean): Promise<void> =>
    ipcRenderer.invoke(IPC.SetOverlayExpanded, expanded),
  onOverlayExpanded: (handler: (expanded: boolean) => void): (() => void) => {
    const listener = (_event: unknown, expanded: boolean) => handler(expanded)
    ipcRenderer.on(IPC.OverlayExpandedChanged, listener)
    return () => {
      ipcRenderer.off(IPC.OverlayExpandedChanged, listener)
    }
  },

  getTasks: (): Promise<Task[]> => ipcRenderer.invoke(IPC.GetTasks),
  addTask: (title: string): Promise<Task[]> => ipcRenderer.invoke(IPC.AddTask, title),
  completeTask: (id: string): Promise<Task[]> => ipcRenderer.invoke(IPC.CompleteTask, id),
  deleteTask: (id: string): Promise<Task[]> => ipcRenderer.invoke(IPC.DeleteTask, id),
  updateTask: (
    id: string,
    patch: { title?: string; deadline?: string | null; priority?: Task['priority'] }
  ): Promise<Task[]> => ipcRenderer.invoke(IPC.UpdateTask, id, patch),
  /** `until` is ISO-8601; the task returns to pending on its own. */
  snoozeTask: (id: string, until: string): Promise<Task[]> =>
    ipcRenderer.invoke(IPC.SnoozeTask, id, until),

  getConfig: (): Promise<Config> => ipcRenderer.invoke(IPC.GetConfig),
  setConfig: (patch: Partial<Config>): Promise<Config> =>
    ipcRenderer.invoke(IPC.SetConfig, patch),
  onConfigChanged: (handler: (config: Config) => void): (() => void) => {
    const listener = (_event: unknown, config: Config) => handler(config)
    ipcRenderer.on(IPC.ConfigChanged, listener)
    return () => {
      ipcRenderer.off(IPC.ConfigChanged, listener)
    }
  },

  onTasksChanged: (handler: (tasks: Task[]) => void): (() => void) => {
    const listener = (_event: unknown, tasks: Task[]) => handler(tasks)
    ipcRenderer.on(IPC.TasksChanged, listener)
    return () => {
      ipcRenderer.off(IPC.TasksChanged, listener)
    }
  },

  onSyncStatus: (handler: (status: { state: 'running' | 'idle' }) => void): (() => void) => {
    const listener = (_event: unknown, status: { state: 'running' | 'idle' }) => handler(status)
    ipcRenderer.on(IPC.SyncStatus, listener)
    return () => {
      ipcRenderer.off(IPC.SyncStatus, listener)
    }
  },

  accounts: {
    status: (): Promise<{
      google: boolean
      googleEmail: string | null
      credentialsConfigured: boolean
    }> => ipcRenderer.invoke(IPC.GetAccountStatus),
    connect: () => ipcRenderer.invoke(IPC.ConnectGoogle),
    disconnect: () => ipcRenderer.invoke(IPC.DisconnectGoogle)
  },

  syncNow: (): Promise<{
    scanned: number
    added: number
    errors: string[]
  }> => ipcRenderer.invoke(IPC.RunSyncNow),

  openChat: () => ipcRenderer.send(IPC.OpenChat),
  chat: (message: string, history: ChatTurn[]): Promise<ChatReply> =>
    ipcRenderer.invoke(IPC.ChatSend, message, history),

  rules: {
    list: (): Promise<RecurrenceRule[]> => ipcRenderer.invoke(IPC.GetRules),
    suggestions: (): Promise<RecurrenceSuggestion[]> => ipcRenderer.invoke(IPC.GetSuggestions),
    acceptSuggestion: (
      id: string
    ): Promise<{ suggestions: RecurrenceSuggestion[]; rules: RecurrenceRule[] }> =>
      ipcRenderer.invoke(IPC.AcceptSuggestion, id),
    dismissSuggestion: (id: string): Promise<RecurrenceSuggestion[]> =>
      ipcRenderer.invoke(IPC.DismissSuggestion, id),
    add: (
      rule: NewRecurrenceRule
    ): Promise<{ rule: RecurrenceRule; rules: RecurrenceRule[] }> =>
      ipcRenderer.invoke(IPC.AddRule, rule),
    update: (
      id: string,
      patch: Partial<Pick<RecurrenceRule, 'title' | 'weekdays' | 'time' | 'priority' | 'enabled'>>
    ): Promise<RecurrenceRule[]> => ipcRenderer.invoke(IPC.UpdateRule, id, patch),
    remove: (id: string): Promise<RecurrenceRule[]> => ipcRenderer.invoke(IPC.DeleteRule, id)
  },

  learned: {
    list: (): Promise<{ title: string; deletes: number }[]> =>
      ipcRenderer.invoke(IPC.GetLearned),
    forget: (title: string): Promise<{ title: string; deletes: number }[]> =>
      ipcRenderer.invoke(IPC.ForgetLearned, title)
  },

  getHealth: (): Promise<HealthReport> => ipcRenderer.invoke(IPC.GetHealth),
  getSyncSummary: (): Promise<SyncSummary> => ipcRenderer.invoke(IPC.GetSyncSummary),

  exportCorpus: (): Promise<{
    path: string
    messages: number
    prefilledTasks: number
    skipped: number
  }> => ipcRenderer.invoke(IPC.ExportCorpus),

  openUserData: () => ipcRenderer.invoke(IPC.OpenUserData),
  getRagCount: (): Promise<number> => ipcRenderer.invoke(IPC.GetRagCount),
  openSettings: () => ipcRenderer.send(IPC.OpenSettings),

  quickAdd: {
    submit: (title: string) => ipcRenderer.send(IPC.QuickAddSubmit, title),
    cancel: () => ipcRenderer.send(IPC.QuickAddCancel),
    setRecording: (recording: boolean) =>
      ipcRenderer.send(IPC.QuickAddRecording, recording),
    /** Mono float32 PCM at 16 kHz. Returns the transcript, or "" if silent. */
    transcribe: (pcm: ArrayBuffer): Promise<string> =>
      ipcRenderer.invoke(IPC.TranscribeAudio, pcm),
    onOpened: (handler: () => void): (() => void) => {
      const listener = () => handler()
      ipcRenderer.on(IPC.QuickAddOpened, listener)
      return () => {
        ipcRenderer.off(IPC.QuickAddOpened, listener)
      }
    }
  }
}

contextBridge.exposeInMainWorld('ambient', api)

export type AmbientApi = typeof api
