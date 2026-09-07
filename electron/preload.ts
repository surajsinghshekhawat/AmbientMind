import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '@shared/ipc'
import type { Task } from '@shared/types'

const api = {
  setMouseCapture: (capture: boolean) => ipcRenderer.send(IPC.SetMouseCapture, capture),
  getTasks: (): Promise<Task[]> => ipcRenderer.invoke(IPC.GetTasks),
  completeTask: (id: string): Promise<Task[]> => ipcRenderer.invoke(IPC.CompleteTask, id),
  onTasksChanged: (handler: (tasks: Task[]) => void): (() => void) => {
    const listener = (_event: unknown, tasks: Task[]) => handler(tasks)
    ipcRenderer.on(IPC.TasksChanged, listener)
    return () => {
      ipcRenderer.off(IPC.TasksChanged, listener)
    }
  }
}

contextBridge.exposeInMainWorld('ambient', api)

export type AmbientApi = typeof api
