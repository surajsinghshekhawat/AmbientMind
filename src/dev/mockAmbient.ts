import type { AmbientApi } from '../../electron/preload'
import type { RecurrenceRule } from '@shared/recurrence'
import {
  DEFAULT_CONFIG,
  type ChatReply,
  type ChatTurn,
  type Config,
  type HealthReport,
  type RecurrenceSuggestion,
  type SpeechEngineInfo,
  type Task
} from '@shared/types'
import type { PermissionKind, PermissionState } from '@shared/permissions'
import {
  findConflicts,
  resolveShortcuts,
  SHORTCUT_NAMES,
  shortcutLabel,
  type ShortcutAction,
  type ShortcutStatus
} from '@shared/shortcuts'
import { sanitizeConfig } from '@shared/config'
import { healthyReport, makeTask } from './fixtures'

type SyncStatus = { state: 'running' | 'idle' }

function channel<T>() {
  const listeners = new Set<(value: T) => void>()
  return {
    on: (handler: (value: T) => void) => {
      listeners.add(handler)
      return () => {
        listeners.delete(handler)
      }
    },
    emit: (value: T) => {
      for (const listener of listeners) listener(value)
    }
  }
}

export interface MockState {
  tasks: Task[]
  config: Config
  health: HealthReport
  rules: RecurrenceRule[]
  suggestions: RecurrenceSuggestion[]
  chatHistory: ChatTurn[]
  google: { connected: boolean; email: string | null; credentialsConfigured: boolean }
  learned: { title: string; deletes: number }[]
  shortcuts: ShortcutStatus[]
  permissions: PermissionState[]
  speech: SpeechEngineInfo
  /** What Apple's live speech returns on stop. */
  liveTranscript: string
}

/**
 * In-memory stand-in for the preload bridge, for component tests and the
 * gallery. Mutations behave like main: they return the new list and emit the
 * matching change event.
 */
export function createMockAmbient(initial: Partial<MockState> = {}) {
  const state: MockState = {
    tasks: [],
    config: { ...DEFAULT_CONFIG },
    health: healthyReport(),
    rules: [],
    suggestions: [],
    chatHistory: [],
    google: { connected: true, email: 'me@example.com', credentialsConfigured: true },
    learned: [],
    shortcuts: [
      { action: 'quickAdd', name: 'Quick add', accelerator: 'Control+Alt+Space', label: '⌃⌥Space', problem: null },
      { action: 'capture', name: 'Capture screen', accelerator: 'Control+Alt+S', label: '⌃⌥S', problem: null },
      { action: 'chat', name: 'Ask about your tasks', accelerator: 'Control+Alt+C', label: '⌃⌥C', problem: null },
      { action: 'settings', name: 'Open settings', accelerator: 'Control+Alt+,', label: '⌃⌥,', problem: null }
    ],
    permissions: [
      { kind: 'microphone', status: 'granted', help: null, canOpenSettings: true },
      { kind: 'screen', status: 'granted', help: null, canOpenSettings: true },
      { kind: 'accessibility', status: 'granted', help: null, canOpenSettings: true }
    ],
    speech: { engine: 'whisper', apple: null, installing: null },
    liveTranscript: '',
    ...initial
  }
  const calls: { method: string; args: unknown[] }[] = []
  const record = (method: string, ...args: unknown[]) => {
    calls.push({ method, args })
  }

  const tasksChanged = channel<Task[]>()
  const configChanged = channel<Config>()
  const syncStatus = channel<SyncStatus>()
  const screenStatus = channel<SyncStatus>()
  const overlayExpanded = channel<boolean>()
  const quickAddOpened = channel<void>()
  const quickAddShortcut = channel<void>()
  const quickAddHold = channel<'start' | 'end'>()
  const speechPartial = channel<{ text: string; final: boolean }>()
  const speechLevel = channel<number>()

  const visible = () => state.tasks.filter((task) => task.status !== 'deleted' && task.status !== 'archived')
  const setTasks = (next: Task[]) => {
    state.tasks = next
    tasksChanged.emit(visible())
    return visible()
  }
  const patchTask = (id: string, patch: Partial<Task>) =>
    setTasks(state.tasks.map((task) => (task.id === id ? { ...task, ...patch } : task)))

  const api = {
    setPanelHeight: (height: number) => record('setPanelHeight', height),
    setOverlayExpanded: async (expanded: boolean) => {
      record('setOverlayExpanded', expanded)
      overlayExpanded.emit(expanded)
    },
    onOverlayExpanded: overlayExpanded.on,

    getTasks: async () => visible(),
    addTask: async (title: string) => setTasks([...state.tasks, makeTask({ title })]),
    completeTask: async (id: string) =>
      patchTask(id, { status: 'done', completedAt: new Date().toISOString() }),
    deleteTask: async (id: string) => patchTask(id, { status: 'deleted', snoozedUntil: null }),
    reopenTask: async (id: string) =>
      patchTask(id, { status: 'pending', completedAt: null, snoozedUntil: null }),
    acceptTask: async (id: string) => patchTask(id, { status: 'pending' }),
    updateTask: async (
      id: string,
      patch: { title?: string; deadline?: string | null; priority?: Task['priority'] }
    ) => patchTask(id, patch),
    snoozeTask: async (id: string, until: string) =>
      patchTask(id, { status: 'snoozed', snoozedUntil: until }),

    getConfig: async () => ({ ...state.config }),
    setConfig: async (patch: Partial<Config>) => {
      state.config = sanitizeConfig({ ...state.config, ...patch })
      if (patch.shortcuts) {
        const set = resolveShortcuts('mac', state.config.shortcuts)
        const conflicts = findConflicts(set, 'mac')
        state.shortcuts = (Object.keys(set) as ShortcutAction[]).map((action) => ({
          action,
          name: SHORTCUT_NAMES[action],
          accelerator: set[action],
          label: shortcutLabel(set[action], 'mac'),
          problem: conflicts[action] ?? null
        }))
      }
      configChanged.emit({ ...state.config })
      return { ...state.config }
    },
    onConfigChanged: configChanged.on,
    onTasksChanged: tasksChanged.on,
    onSyncStatus: syncStatus.on,
    onScreenStatus: screenStatus.on,

    accounts: {
      status: async () => ({
        google: state.google.connected,
        googleEmail: state.google.email,
        credentialsConfigured: state.google.credentialsConfigured
      }),
      connect: async () => record('accounts.connect'),
      disconnect: async () => record('accounts.disconnect')
    },

    syncNow: async () => {
      syncStatus.emit({ state: 'running' })
      syncStatus.emit({ state: 'idle' })
      return { scanned: 0, added: 0, errors: [] as string[] }
    },

    openChat: () => record('openChat'),
    closeChat: () => record('closeChat'),
    stopChat: () => record('stopChat'),
    chat: async (message: string, history: ChatTurn[]): Promise<ChatReply> => {
      record('chat', message, history)
      return { reply: `Mock reply to: ${message}`, actions: [], changed: false }
    },
    getChatHistory: async () => [...state.chatHistory],
    saveChatHistory: async (turns: ChatTurn[]) => {
      state.chatHistory = turns
      return turns
    },

    rules: {
      list: async () => [...state.rules],
      suggestions: async () => [...state.suggestions],
      acceptSuggestion: async (id: string) => {
        const accepted = state.suggestions.find((s) => s.id === id)
        state.suggestions = state.suggestions.filter((s) => s.id !== id)
        if (accepted) {
          state.rules = [
            ...state.rules,
            {
              id: `rule-${accepted.id}`,
              title: accepted.title,
              weekdays: accepted.weekdays,
              time: accepted.time,
              priority: 'medium',
              leadMinutes: 60,
              enabled: true,
              createdAt: new Date().toISOString(),
              source: 'suggested'
            }
          ]
        }
        return { suggestions: [...state.suggestions], rules: [...state.rules] }
      },
      dismissSuggestion: async (id: string) => {
        state.suggestions = state.suggestions.filter((s) => s.id !== id)
        return [...state.suggestions]
      },
      add: async (rule: Parameters<AmbientApi['rules']['add']>[0]) => {
        const created: RecurrenceRule = {
          ...rule,
          id: rule.id ?? `rule-${state.rules.length + 1}`,
          createdAt: rule.createdAt ?? new Date().toISOString()
        }
        state.rules = [...state.rules, created]
        return { rule: created, rules: [...state.rules] }
      },
      update: async (id: string, patch: Parameters<AmbientApi['rules']['update']>[1]) => {
        state.rules = state.rules.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule))
        return [...state.rules]
      },
      remove: async (id: string) => {
        state.rules = state.rules.filter((rule) => rule.id !== id)
        return [...state.rules]
      }
    },

    learned: {
      list: async () => [...state.learned],
      forget: async (title: string) => {
        state.learned = state.learned.filter((entry) => entry.title !== title)
        return [...state.learned]
      }
    },

    getHealth: async () => state.health,
    getSyncSummary: async () => ({
      lastRun: null as string | null,
      lastError: null as string | null,
      lastReport: null
    }),
    exportCorpus: async () => ({ path: '/mock/corpus.jsonl', messages: 0, prefilledTasks: 0, skipped: 0 }),
    exportBackup: async (passphrase: string) => {
      record('exportBackup', passphrase)
      return { canceled: true as const }
    },
    getAppInfo: async () => ({ version: '0.0.0-mock', userData: '/mock/userData' }),
    openUserData: async () => record('openUserData'),
    getShortcuts: async () => state.shortcuts,
    suspendShortcuts: (suspended: boolean) => record('suspendShortcuts', suspended),
    getPermissions: async () => state.permissions,
    openPermissionSettings: async (kind: PermissionKind) => {
      record('openPermissionSettings', kind)
    },
    requestPermission: async (kind: PermissionKind) => {
      record('requestPermission', kind)
      const granted: PermissionState = { kind, status: 'granted', help: null, canOpenSettings: true }
      state.permissions = state.permissions.map((p) => (p.kind === kind ? granted : p))
      return granted
    },
    getRagCount: async () => 0,
    openSettings: () => record('openSettings'),
    openOnboarding: () => record('openOnboarding'),
    finishOnboarding: () => {
      record('finishOnboarding')
      state.config = { ...state.config, onboarded: true }
      configChanged.emit({ ...state.config })
    },

    quickAdd: {
      open: () => record('quickAdd.open'),
      submit: (title: string, options?: { keepOpen?: boolean }) => record('quickAdd.submit', title, options),
      setHeight: (height: number) => record('quickAdd.setHeight', height),
      cancel: () => record('quickAdd.cancel'),
      setRecording: (recording: boolean) => record('quickAdd.setRecording', recording),
      transcribe: async (_pcm: ArrayBuffer) => '',
      onOpened: (handler: () => void) => quickAddOpened.on(handler),
      onShortcutAgain: (handler: () => void) => quickAddShortcut.on(handler),
      onHold: quickAddHold.on
    },
    speech: {
      engine: async () => state.speech,
      install: async () => {
        record('speech.install')
        state.speech = { engine: 'apple', apple: { available: true, installed: true, downloading: false, locale: 'en-US' }, installing: null }
        return state.speech
      },
      start: async () => record('speech.start'),
      stop: async () => {
        record('speech.stop')
        return state.liveTranscript
      },
      cancel: () => record('speech.cancel'),
      onPartial: speechPartial.on,
      onLevel: speechLevel.on
    }
  } satisfies AmbientApi

  return {
    api,
    state,
    calls,
    emit: {
      tasksChanged: (tasks: Task[]) => setTasks(tasks),
      configChanged: configChanged.emit,
      syncStatus: syncStatus.emit,
      screenStatus: screenStatus.emit,
      overlayExpanded: overlayExpanded.emit,
      quickAddOpened: () => quickAddOpened.emit(),
      quickAddShortcut: () => quickAddShortcut.emit(),
      quickAddHold: quickAddHold.emit,
      speechPartial: speechPartial.emit,
      speechLevel: speechLevel.emit
    }
  }
}

export type MockAmbient = ReturnType<typeof createMockAmbient>

export function installMockAmbient(initial: Partial<MockState> = {}): MockAmbient {
  const mock = createMockAmbient(initial)
  window.ambient = mock.api
  return mock
}
