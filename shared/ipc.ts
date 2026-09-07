export const IPC = {
  /** Renderer -> main, fired on hover transitions to toggle click-through. */
  SetMouseCapture: 'overlay:set-mouse-capture',

  GetTasks: 'tasks:get',
  AddTask: 'tasks:add',
  CompleteTask: 'tasks:complete',
  DeleteTask: 'tasks:delete',
  /** Main -> renderer, pushed whenever the task store changes. */
  TasksChanged: 'tasks:changed',

  /** Renderer -> main, resizes the window between orb and panel. */
  SetOverlayExpanded: 'overlay:set-expanded',

  ConnectGoogle: 'accounts:connect-google',
  DisconnectGoogle: 'accounts:disconnect-google',
  GetAccountStatus: 'accounts:status',
  RunSyncNow: 'sync:run-now',
  /** Main -> renderer, so the overlay can show a quiet sync indicator. */
  SyncStatus: 'sync:status',

  QuickAddSubmit: 'quickadd:submit',
  QuickAddCancel: 'quickadd:cancel',
  /** Main -> quick-add renderer, so it can reset and focus its input. */
  QuickAddOpened: 'quickadd:opened'
} as const

export const QUICK_ADD_SHORTCUT = 'CommandOrControl+Shift+A'
