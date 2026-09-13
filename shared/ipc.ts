export const IPC = {
  /** Renderer -> main, fired on hover transitions to toggle click-through. */
  SetMouseCapture: 'overlay:set-mouse-capture',

  GetTasks: 'tasks:get',
  AddTask: 'tasks:add',
  CompleteTask: 'tasks:complete',
  DeleteTask: 'tasks:delete',
  UpdateTask: 'tasks:update',
  SnoozeTask: 'tasks:snooze',
  /** Main -> renderer, pushed whenever the task store changes. */
  TasksChanged: 'tasks:changed',

  /** Renderer -> main, resizes the window between orb and panel. */
  SetOverlayExpanded: 'overlay:set-expanded',
  /** Main -> renderer, after the overlay is collapsed or expanded. */
  OverlayExpandedChanged: 'overlay:expanded-changed',

  GetConfig: 'config:get',
  SetConfig: 'config:set',
  /** Main -> renderer, after a settings change. */
  ConfigChanged: 'config:changed',

  ConnectGoogle: 'accounts:connect-google',
  DisconnectGoogle: 'accounts:disconnect-google',
  GetAccountStatus: 'accounts:status',
  RunSyncNow: 'sync:run-now',
  /** Main -> renderer, so the overlay can show a quiet sync indicator. */
  SyncStatus: 'sync:status',

  /** Patterns the app noticed; shown for confirmation, never auto-applied. */
  GetSuggestions: 'rules:suggestions',
  AcceptSuggestion: 'rules:suggestion-accept',
  DismissSuggestion: 'rules:suggestion-dismiss',

  ChatSend: 'chat:send',
  OpenChat: 'chat:open',

  GetRules: 'rules:get',
  AddRule: 'rules:add',
  UpdateRule: 'rules:update',
  DeleteRule: 'rules:delete',

  /** Is Ollama up, are the models pulled, is Google connected. */
  GetHealth: 'health:get',
  /** Last sync outcome, so the UI is not the only place it ever appeared. */
  GetSyncSummary: 'sync:summary',

  /** Writes recent mail to JSONL, pre-labelled, for accuracy measurement. */
  ExportCorpus: 'eval:export-corpus',

  OpenUserData: 'settings:open-user-data',
  GetRagCount: 'settings:rag-count',
  OpenSettings: 'settings:open',

  QuickAddSubmit: 'quickadd:submit',
  QuickAddCancel: 'quickadd:cancel',
  /** Main -> quick-add renderer, so it can reset and focus its input. */
  QuickAddOpened: 'quickadd:opened',
  /** Renderer -> main: keep the window open while the mic is live. */
  QuickAddRecording: 'quickadd:recording',
  /** Renderer -> main: float32 PCM @ 16 kHz ArrayBuffer in, transcript out. */
  TranscribeAudio: 'speech:transcribe'
} as const

export const QUICK_ADD_SHORTCUT = 'CommandOrControl+Shift+A'
/** Reads the current screen and turns it into a task. */
export const CAPTURE_SCREEN_SHORTCUT = 'CommandOrControl+Shift+S'
export const SETTINGS_SHORTCUT = 'CommandOrControl+Shift+,'
/** Opens the chat panel, which can both answer about and change the list. */
export const CHAT_SHORTCUT = 'CommandOrControl+Shift+C'
