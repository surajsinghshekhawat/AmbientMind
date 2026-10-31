export const IPC = {
  GetTasks: 'tasks:get',
  AddTask: 'tasks:add',
  CompleteTask: 'tasks:complete',
  DeleteTask: 'tasks:delete',
  UpdateTask: 'tasks:update',
  SnoozeTask: 'tasks:snooze',
  /** Undo for complete, snooze and delete. */
  ReopenTask: 'tasks:reopen',
  /** A suggested task becomes a real one. */
  AcceptTask: 'tasks:accept',
  /** Main -> renderer, pushed whenever the task store changes. */
  TasksChanged: 'tasks:changed',

  /** Renderer -> main, resizes the window between orb and panel. */
  SetOverlayExpanded: 'overlay:set-expanded',
  /** Main -> renderer, after the overlay is collapsed or expanded. */
  OverlayExpandedChanged: 'overlay:expanded-changed',
  /** Renderer -> main: the panel's content height, so the window fits it. */
  SetPanelHeight: 'overlay:set-panel-height',

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
  /** Main -> renderer. Separate from sync so neither can end the other's indicator. */
  ScreenStatus: 'screen:status',

  /** Patterns the app noticed; shown for confirmation, never auto-applied. */
  GetSuggestions: 'rules:suggestions',
  AcceptSuggestion: 'rules:suggestion-accept',
  DismissSuggestion: 'rules:suggestion-dismiss',

  ChatSend: 'chat:send',
  ChatStop: 'chat:stop',
  /** Renderer -> main: the chat card's close button and Esc. */
  CloseChat: 'chat:close',
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
  GetLearned: 'learned:get',
  ForgetLearned: 'learned:forget',
  ExportCorpus: 'eval:export-corpus',

  /** Each global shortcut, its label, and whether it could be registered. */
  GetShortcuts: 'shortcuts:get',
  /** Microphone and screen recording status, with what to do when refused. */
  GetPermissions: 'permissions:get',
  OpenPermissionSettings: 'permissions:open-settings',
  RequestPermission: 'permissions:request',

  OpenUserData: 'settings:open-user-data',
  GetRagCount: 'settings:rag-count',
  OpenSettings: 'settings:open',
  OpenOnboarding: 'onboarding:open',
  FinishOnboarding: 'onboarding:finish',
  GetAppInfo: 'app:info',
  ExportBackup: 'settings:export-backup',
  SuspendShortcuts: 'settings:suspend-shortcuts',
  GetChatHistory: 'chat:history-get',
  SaveChatHistory: 'chat:history-save',

  OpenQuickAdd: 'quickadd:open',
  QuickAddSubmit: 'quickadd:submit',
  QuickAddCancel: 'quickadd:cancel',
  /** Main -> quick-add renderer, so it can reset and focus its input. */
  QuickAddOpened: 'quickadd:opened',
  /** Renderer -> main: keep the window open while the mic is live. */
  QuickAddRecording: 'quickadd:recording',
  /** Main -> quick-add renderer: the capture shortcut was pressed while open. */
  QuickAddShortcutAgain: 'quickadd:shortcut-again',
  /** Renderer -> main: the composer's height, so the window fits it. */
  QuickAddHeight: 'quickadd:height',
  /** Main -> quick-add renderer: the shortcut is held ('start') or let go ('end'). */
  QuickAddHold: 'quickadd:hold',
  /** Renderer -> main: float32 PCM @ 16 kHz ArrayBuffer in, transcript out. */
  TranscribeAudio: 'speech:transcribe',
  /** Which voice engine is in use, and the state of Apple's speech model. */
  SpeechEngine: 'speech:engine',
  SpeechInstall: 'speech:install',
  /** Live dictation through the helper: start, stop (returns the text), cancel. */
  SpeechStart: 'speech:start',
  SpeechStop: 'speech:stop',
  SpeechCancel: 'speech:cancel',
  /** Main -> quick-add renderer while listening: the words so far, and the input level. */
  AppleSources: 'sources:apple',
  SetAppleSource: 'sources:apple-set',
  SpeechPartial: 'speech:partial',
  SpeechLevel: 'speech:level'
} as const
