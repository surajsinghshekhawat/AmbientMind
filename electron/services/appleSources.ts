import { fromAppleEvent, PREP_LOOKAHEAD_HOURS, prepTaskFor, withoutGoogleCopies } from '@shared/calendarPrep'
import { HelperError, type HelperAccess } from '@shared/helperProtocol'
import type { AppleSourcesStatus, Config } from '@shared/types'
import { helperHas, helperRequest, onHelperEvent, onHelperState } from '../native/helper'
import { isMac } from '../platform'
import { loadConfig } from './config'
import { rejectDuplicates } from './dedup'
import { suppressionFor } from './decisionStore'
import { isGoogleConnected } from './googleAuth'
import { countReminderLinks } from './reminderStore'
import { REMINDERS_LIST_TITLE, syncReminders, type ReminderList, type RemindersRemote } from './reminders'
import { addTasksIgnoringDuplicates, getSyncState, listActive, listSyncStates, reconcileCalendarTasks, setSyncState } from './taskStore'

/**
 * Apple Calendar and Reminders, through the helper's EventKit methods.
 *
 * Both are opt-in and Mac-only. Calendar is read-only and works like Google
 * Calendar: meetings coming up become prep tasks. Reminders is two-way with
 * one list AmbientMind owns. A pass runs when either side changes (EventKit's
 * change notification covers iPhone edits arriving through iCloud), and every
 * few minutes in case a notification was missed.
 */

export type AppleSource = 'calendar' | 'reminders'

const FLAG: Record<AppleSource, 'appleCalendar' | 'remindersSync'> = { calendar: 'appleCalendar', reminders: 'remindersSync' }
const STATE_KEY: Record<AppleSource, string> = { calendar: 'acalendar', reminders: 'reminders' }
const SETTINGS_PANE: Record<AppleSource, string> = { calendar: 'Calendars', reminders: 'Reminders' }
const NAME: Record<AppleSource, string> = { calendar: 'Calendar', reminders: 'Reminders' }

const SAFETY_PASS_MS = 5 * 60_000
const LOCAL_CHANGE_DEBOUNCE_MS = 1500

let onTasksChanged: () => void = () => {}
let applying = false

function available(): boolean {
  return isMac && helperHas('eventkit')
}

const helperRemote: RemindersRemote = {
  ensureList: (id) => helperRequest('reminders.ensureList', { title: REMINDERS_LIST_TITLE, id }, { timeoutMs: 15_000 }),
  list: async (listId) => (await helperRequest('reminders.list', { listId }, { timeoutMs: 20_000 })).reminders,
  upsert: (write) => helperRequest('reminders.upsert', write, { timeoutMs: 10_000 }),
  remove: async (id, expectedModifiedAt) =>
    (await helperRequest('reminders.delete', { id, ...(expectedModifiedAt ? { expectedModifiedAt } : {}) }, { timeoutMs: 10_000 })).deleted
}

function announce() {
  applying = true
  try {
    onTasksChanged()
  } finally {
    applying = false
  }
}

/** One pass at a time per source; a request during a pass runs once after it. */
function serial(run: () => Promise<void>) {
  let running = false
  let again = false
  const go = async (): Promise<void> => {
    if (running) {
      again = true
      return
    }
    running = true
    try {
      await run()
    } finally {
      running = false
      if (again) {
        again = false
        void go()
      }
    }
  }
  return go
}

export const syncAppleCalendar = serial(async () => {
  const config = loadConfig()
  if (!available() || !config.appleCalendar) return
  const now = new Date()
  try {
    const { events } = await helperRequest(
      'calendar.events',
      { from: now.toISOString(), to: new Date(now.getTime() + PREP_LOOKAHEAD_HOURS * 3_600_000).toISOString() },
      { timeoutMs: 20_000 }
    )
    let prep = events.flatMap((event) => prepTaskFor(fromAppleEvent(event), now, 'acalendar') ?? [])
    if (isGoogleConnected()) {
      const cursor = getSyncState('gcalendar').cursor
      const uids = cursor ? (JSON.parse(cursor) as string[]) : []
      const tasks = listActive().filter((task) => task.source === 'gcalendar')
      prep = withoutGoogleCopies(prep, { uids, tasks })
    }
    const { fresh, updated, removed, archived } = reconcileCalendarTasks('acalendar', prep, now)
    const { accepted } = rejectDuplicates(fresh, listActive())
    const added = addTasksIgnoringDuplicates(accepted.filter((task) => !suppressionFor(task.title).suppressed)).length
    setSyncState('acalendar', null)
    if (added + updated + removed + archived > 0) announce()
  } catch (err) {
    setSyncState('acalendar', null, (err as Error).message)
  }
})

function knownList(): ReminderList | null {
  const cursor = getSyncState('reminders').cursor
  try {
    return cursor ? (JSON.parse(cursor) as ReminderList) : null
  } catch {
    return null
  }
}

export const syncAppleReminders = serial(async () => {
  const config = loadConfig()
  if (!available() || !config.remindersSync) return
  const known = knownList()
  try {
    const report = await syncReminders(helperRemote, known)
    setSyncState('reminders', JSON.stringify(report.list), report.errors[0] ?? null)
    if (report.changedLocal) announce()
    // Something moved underneath a write; go again rather than wait minutes.
    if (report.conflicts > 0) setTimeout(() => void syncAppleReminders(), 2000)
  } catch (err) {
    setSyncState('reminders', known ? JSON.stringify(known) : null, (err as Error).message)
  }
})

function syncAll() {
  void syncAppleCalendar()
  void syncAppleReminders()
}

let localTimer: NodeJS.Timeout | null = null

/** Called whenever tasks change here, so Reminders follows within a moment. */
export function noteLocalTaskChange(): void {
  if (applying || !loadConfig().remindersSync || !available()) return
  if (localTimer) clearTimeout(localTimer)
  localTimer = setTimeout(() => {
    localTimer = null
    void syncAppleReminders()
  }, LOCAL_CHANGE_DEBOUNCE_MS)
}

export function initAppleSources(handlers: { onTasksChanged: () => void }): void {
  if (!isMac) return
  onTasksChanged = handlers.onTasksChanged
  onHelperState((state) => {
    if (state === 'ready') syncAll()
  })
  onHelperEvent('eventstore.changed', () => syncAll())
  setInterval(syncAll, SAFETY_PASS_MS).unref()
}

/** Switching a source on or off from Settings, after asking macOS when needed. */
export async function setAppleSource(source: AppleSource, on: boolean, save: (patch: Partial<Config>) => void): Promise<void> {
  if (on) await ensureAccess(source)
  save({ [FLAG[source]]: on })
  if (!on && source === 'calendar') {
    // Its prep tasks go with it; done and deleted ones stay as history.
    if (reconcileCalendarTasks('acalendar', []).removed > 0) announce()
  }
  if (on) await (source === 'calendar' ? syncAppleCalendar() : syncAppleReminders())
}

async function access(source: AppleSource): Promise<HelperAccess | 'unknown'> {
  if (!available()) return 'unknown'
  try {
    const result = await helperRequest('perms.status', { kinds: [source] })
    return result[source] ?? 'unknown'
  } catch {
    return 'unknown'
  }
}

async function ensureAccess(source: AppleSource): Promise<void> {
  if (!available()) throw new Error(`${NAME[source]} needs the AmbientMind helper, which isn’t running.`)
  let status = await access(source)
  if (status === 'not-determined') {
    try {
      status = (await helperRequest('perms.request', { kind: source }, { timeoutMs: 120_000 })).status
    } catch (err) {
      if (err instanceof HelperError && err.code === 'missing_usage_description') {
        throw new Error(
          `macOS asks on behalf of the app that started AmbientMind, and in development that app can’t ask for ${NAME[source]}. Use the installed app to allow it.`
        )
      }
      throw err
    }
  }
  if (status !== 'granted') {
    throw new Error(`${NAME[source]} access is off for AmbientMind. Turn it on in System Settings → Privacy & Security → ${SETTINGS_PANE[source]}.`)
  }
}

export async function appleSourcesStatus(): Promise<AppleSourcesStatus> {
  const config = loadConfig()
  const states = new Map(listSyncStates().map((state) => [state.source, state]))
  const state = (source: AppleSource) => {
    const row = states.get(STATE_KEY[source])
    return { enabled: config[FLAG[source]], lastRun: row?.lastRun ?? null, lastError: row?.lastError ?? null }
  }
  const [calendarAccess, remindersAccess] = await Promise.all([access('calendar'), access('reminders')])
  const list = knownList()
  return {
    available: available(),
    calendar: {
      ...state('calendar'),
      access: calendarAccess,
      upcoming: listActive().filter((task) => task.source === 'acalendar' && task.status === 'pending').length
    },
    reminders: {
      ...state('reminders'),
      access: remindersAccess,
      list: list ? (list.account ? `${list.title} · ${list.account}` : list.title) : null,
      linked: countReminderLinks()
    }
  }
}
