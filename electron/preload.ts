import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '@shared/ipc'
import type { Config, Task } from '@shared/types'

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
