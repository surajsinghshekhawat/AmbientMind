export const IPC = {
  /** Renderer -> main, fired on hover transitions to toggle click-through. */
  SetMouseCapture: 'overlay:set-mouse-capture',

  GetTasks: 'tasks:get',
  AddTask: 'tasks:add',
  CompleteTask: 'tasks:complete',
  DeleteTask: 'tasks:delete',
  /** Main -> renderer, pushed whenever the task store changes. */
  TasksChanged: 'tasks:changed',

  QuickAddSubmit: 'quickadd:submit',
  QuickAddCancel: 'quickadd:cancel',
  /** Main -> quick-add renderer, so it can reset and focus its input. */
  QuickAddOpened: 'quickadd:opened'
} as const

export const QUICK_ADD_SHORTCUT = 'CommandOrControl+Shift+A'
