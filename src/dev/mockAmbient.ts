import type { AmbientApi } from '../../electron/preload'
import type { RecurrenceRule } from '@shared/recurrence'
import {
  DEFAULT_CONFIG,
  type ChatTurn,
  type Config,
  type HealthReport,
  type RecurrenceSuggestion,
  type Task
} from '@shared/types'
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
    ...initial
  }
  const calls: { method: string; args: unknown[] }[] = []
  const record = (method: string, ...args: unknown[]) => {
    calls.push({ method, args })
  }

  const tasksChanged = channel<Task[]>()
  const configChanged = channel<Config>()
  const syncStatus = channel<SyncStatus>()
  const overlayExpanded = channel<boolean>()
  const quickAddOpened = channel<void>()

  const setTasks = (next: Task[]) => {
    state.tasks = next
    tasksChanged.emit([...next])
    return [...next]
  }
  const patchTask = (id: string, patch: Partial<Task>) =>
    setTasks(state.tasks.map((task) => (task.id === id ? { ...task, ...patch } : task)))

  const api = {
    setMouseCapture: (capture: boolean) => record('setMouseCapture', capture),
    setOverlayExpanded: async (expanded: boolean) => {
      record('setOverlayExpanded', expanded)
      overlayExpanded.emit(expanded)
    },
    onOverlayExpanded: overlayExpanded.on,

    getTasks: async () => [...state.tasks],
    addTask: async (title: string) => setTasks([...state.tasks, makeTask({ title })]),
    completeTask: async (id: string) =>
      patchTask(id, { status: 'done', completedAt: new Date().toISOString() }),
    deleteTask: async (id: string) => setTasks(state.tasks.filter((task) => task.id !== id)),
    updateTask: async (
      id: string,
      patch: { title?: string; deadline?: string | null; priority?: Task['priority'] }
    ) => patchTask(id, patch),
    snoozeTask: async (id: string, until: string) =>
      patchTask(id, { status: 'snoozed', snoozedUntil: until }),

    getConfig: async () => ({ ...state.config }),
    setConfig: async (patch: Partial<Config>) => {
      state.config = { ...state.config, ...patch }
      configChanged.emit({ ...state.config })
      return { ...state.config }
    },
    onConfigChanged: configChanged.on,
    onTasksChanged: tasksChanged.on,
    onSyncStatus: syncStatus.on,

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
    chat: async (message: string, history: ChatTurn[]) => {
      record('chat', message, history)
      return { reply: `Mock reply to: ${message}`, actions: [] as string[], changed: false }
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
    getRagCount: async () => 0,
    openSettings: () => record('openSettings'),

    quickAdd: {
      submit: (title: string) => record('quickAdd.submit', title),
      cancel: () => record('quickAdd.cancel'),
      setRecording: (recording: boolean) => record('quickAdd.setRecording', recording),
      transcribe: async (_pcm: ArrayBuffer) => '',
      onOpened: (handler: () => void) => quickAddOpened.on(handler)
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
      overlayExpanded: overlayExpanded.emit,
      quickAddOpened: () => quickAddOpened.emit()
    }
  }
}

export type MockAmbient = ReturnType<typeof createMockAmbient>

export function installMockAmbient(initial: Partial<MockState> = {}): MockAmbient {
  const mock = createMockAmbient(initial)
  window.ambient = mock.api
  return mock
}
