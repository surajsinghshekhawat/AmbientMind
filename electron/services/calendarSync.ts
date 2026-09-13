import { isGoogleConnected } from './googleAuth'
import { CalendarScopeError, pushRule, removeRule } from './integrations/gcalendarWrite'
import { loadConfig } from './config'
import { getRule, getRuleEventId, listRules, setRuleEventId } from './ruleStore'

/**
 * Mirrors recurrence rules onto the app's own Google Calendar.
 *
 * Opt-in, because it writes to the user's account: silently creating events in
 * someone's calendar is not a default anyone should have to discover. Every
 * entry point here is best-effort — the local rule is the source of truth, and
 * a calendar that is unreachable must never block creating or editing one.
 */
function enabled(): boolean {
  return loadConfig().calendarWriteBack && isGoogleConnected()
}

export interface CalendarPushResult {
  pushed: number
  /** Set when the grant predates write-back and the user must reconnect. */
  needsReconnect: boolean
  errors: string[]
}

export async function syncRuleToCalendar(ruleId: string): Promise<CalendarPushResult> {
  const result: CalendarPushResult = { pushed: 0, needsReconnect: false, errors: [] }
  if (!enabled()) return result

  const rule = getRule(ruleId)
  if (!rule) return result

  try {
    const eventId = await pushRule(rule, getRuleEventId(ruleId))
    setRuleEventId(ruleId, eventId)
    result.pushed = 1
  } catch (err) {
    if (err instanceof CalendarScopeError) result.needsReconnect = true
    result.errors.push(`${rule.title}: ${(err as Error).message}`)
  }
  return result
}

export async function removeRuleFromCalendar(eventId: string | null): Promise<void> {
  if (!eventId || !enabled()) return
  await removeRule(eventId).catch(() => undefined)
}

/** Used when write-back is switched on, to backfill rules made before then. */
export async function syncAllRulesToCalendar(): Promise<CalendarPushResult> {
  const result: CalendarPushResult = { pushed: 0, needsReconnect: false, errors: [] }
  if (!enabled()) return result

  for (const rule of listRules()) {
    const one = await syncRuleToCalendar(rule.id)
    result.pushed += one.pushed
    result.needsReconnect ||= one.needsReconnect
    result.errors.push(...one.errors)
    // One missing scope will fail identically for every remaining rule.
    if (one.needsReconnect) break
  }
  return result
}
