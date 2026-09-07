import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '@shared/ipc'
import type { Task } from '@shared/types'

const api = {
  setMouseCapture: (capture: boolean) => ipcRenderer.send(IPC.SetMouseCapture, capture),

  getTasks: (): Promise<Task[]> => ipcRenderer.invoke(IPC.GetTasks),
  addTask: (title: string): Promise<Task[]> => ipcRenderer.invoke(IPC.AddTask, title),
  completeTask: (id: string): Promise<Task[]> => ipcRenderer.invoke(IPC.CompleteTask, id),
  deleteTask: (id: string): Promise<Task[]> => ipcRenderer.invoke(IPC.DeleteTask, id),

  onTasksChanged: (handler: (tasks: Task[]) => void): (() => void) => {
    const listener = (_event: unknown, tasks: Task[]) => handler(tasks)
    ipcRenderer.on(IPC.TasksChanged, listener)
    return () => {
      ipcRenderer.off(IPC.TasksChanged, listener)
    }
  },

  quickAdd: {
    submit: (title: string) => ipcRenderer.send(IPC.QuickAddSubmit, title),
    cancel: () => ipcRenderer.send(IPC.QuickAddCancel),
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
