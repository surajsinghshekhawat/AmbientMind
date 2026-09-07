export const IPC = {
  /** Renderer -> main, fired on hover transitions to toggle click-through. */
  SetMouseCapture: 'overlay:set-mouse-capture',
  GetTasks: 'tasks:get',
  CompleteTask: 'tasks:complete',
  /** Main -> renderer, pushed whenever the task store changes. */
  TasksChanged: 'tasks:changed'
} as const
