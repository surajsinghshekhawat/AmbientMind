import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '@shared/ipc'
import type {
  ChatReply,
  ChatTurn,
  Config,
  HealthReport,
  RecurrenceSuggestion,
  SpeechEngineInfo,
  SyncSummary,
  Task
} from '@shared/types'
import type { NewRecurrenceRule, RecurrenceRule } from '@shared/recurrence'
import type { PermissionKind, PermissionState } from '@shared/permissions'
import type { ShortcutStatus } from '@shared/shortcuts'

const api = {
  setPanelHeight: (height: number) => ipcRenderer.send(IPC.SetPanelHeight, height),
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
  reopenTask: (id: string): Promise<Task[]> => ipcRenderer.invoke(IPC.ReopenTask, id),
  acceptTask: (id: string): Promise<Task[]> => ipcRenderer.invoke(IPC.AcceptTask, id),
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

  onScreenStatus: (handler: (status: { state: 'running' | 'idle' }) => void): (() => void) => {
    const listener = (_event: unknown, status: { state: 'running' | 'idle' }) => handler(status)
    ipcRenderer.on(IPC.ScreenStatus, listener)
    return () => {
      ipcRenderer.off(IPC.ScreenStatus, listener)
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
  closeChat: () => ipcRenderer.send(IPC.CloseChat),
  stopChat: () => ipcRenderer.send(IPC.ChatStop),
  chat: (message: string, history: ChatTurn[]): Promise<ChatReply> =>
    ipcRenderer.invoke(IPC.ChatSend, message, history),
  getChatHistory: (): Promise<ChatTurn[]> => ipcRenderer.invoke(IPC.GetChatHistory),
  saveChatHistory: (turns: ChatTurn[]): Promise<ChatTurn[]> =>
    ipcRenderer.invoke(IPC.SaveChatHistory, turns),

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

  exportBackup: (
    passphrase: string
  ): Promise<{ canceled: true } | { canceled: false; path: string }> =>
    ipcRenderer.invoke(IPC.ExportBackup, passphrase),

  getAppInfo: (): Promise<{ version: string; userData: string }> =>
    ipcRenderer.invoke(IPC.GetAppInfo),

  openUserData: () => ipcRenderer.invoke(IPC.OpenUserData),
  getShortcuts: (): Promise<ShortcutStatus[]> => ipcRenderer.invoke(IPC.GetShortcuts),
  suspendShortcuts: (suspended: boolean) => ipcRenderer.send(IPC.SuspendShortcuts, suspended),
  getPermissions: (): Promise<PermissionState[]> => ipcRenderer.invoke(IPC.GetPermissions),
  openPermissionSettings: (kind: PermissionKind): Promise<void> =>
    ipcRenderer.invoke(IPC.OpenPermissionSettings, kind),
  requestPermission: (kind: PermissionKind): Promise<PermissionState> =>
    ipcRenderer.invoke(IPC.RequestPermission, kind),
  getRagCount: (): Promise<number> => ipcRenderer.invoke(IPC.GetRagCount),
  openSettings: () => ipcRenderer.send(IPC.OpenSettings),
  openOnboarding: () => ipcRenderer.send(IPC.OpenOnboarding),
  finishOnboarding: () => ipcRenderer.send(IPC.FinishOnboarding),

  quickAdd: {
    open: () => ipcRenderer.send(IPC.OpenQuickAdd),
    submit: (title: string, options?: { keepOpen?: boolean }) =>
      ipcRenderer.send(IPC.QuickAddSubmit, title, options),
    setHeight: (height: number) => ipcRenderer.send(IPC.QuickAddHeight, height),
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
    },
    onShortcutAgain: (handler: () => void): (() => void) => {
      const listener = () => handler()
      ipcRenderer.on(IPC.QuickAddShortcutAgain, listener)
      return () => {
        ipcRenderer.off(IPC.QuickAddShortcutAgain, listener)
      }
    },
    /** The shortcut is held down ('start') or let go after a hold ('end'). */
    onHold: (handler: (phase: 'start' | 'end') => void): (() => void) => {
      const listener = (_event: unknown, phase: 'start' | 'end') => handler(phase)
      ipcRenderer.on(IPC.QuickAddHold, listener)
      return () => {
        ipcRenderer.off(IPC.QuickAddHold, listener)
      }
    }
  },

  speech: {
    engine: (): Promise<SpeechEngineInfo> => ipcRenderer.invoke(IPC.SpeechEngine),
    /** Downloads Apple's speech model; macOS stores it with its other language assets. */
    install: (): Promise<SpeechEngineInfo> => ipcRenderer.invoke(IPC.SpeechInstall),
    start: (): Promise<void> => ipcRenderer.invoke(IPC.SpeechStart),
    stop: (): Promise<string> => ipcRenderer.invoke(IPC.SpeechStop),
    cancel: () => ipcRenderer.send(IPC.SpeechCancel),
    onPartial: (handler: (partial: { text: string; final: boolean }) => void): (() => void) => {
      const listener = (_event: unknown, partial: { text: string; final: boolean }) => handler(partial)
      ipcRenderer.on(IPC.SpeechPartial, listener)
      return () => {
        ipcRenderer.off(IPC.SpeechPartial, listener)
      }
    },
    onLevel: (handler: (rms: number) => void): (() => void) => {
      const listener = (_event: unknown, rms: number) => handler(rms)
      ipcRenderer.on(IPC.SpeechLevel, listener)
      return () => {
        ipcRenderer.off(IPC.SpeechLevel, listener)
      }
    }
  }
}

contextBridge.exposeInMainWorld('ambient', api)

export type AmbientApi = typeof api
