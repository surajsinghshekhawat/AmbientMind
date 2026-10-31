import { app, systemPreferences } from 'electron'
import type { HelperAccess } from '@shared/helperProtocol'
import { helperRequest, startHelper, stopHelper } from './helper'

export interface HelperCheck {
  ok: boolean
  helper: { version: string; responsibleApp: string | null; parentApp: string | null } | null
  appBundleId: string | null
  /** Each permission as the app sees it and as the helper sees it. */
  permissions: { kind: string; app: string; helper: HelperAccess | 'missing' }[]
  problems: string[]
}

/**
 * `AmbientMind --helper-check`: proves macOS attributes the helper's
 * permissions to AmbientMind. Only meaningful when the app was launched
 * through LaunchServices (`open`); run from a terminal, the terminal is
 * responsible for both and the check says so.
 */
export async function runHelperCheck(): Promise<HelperCheck> {
  const problems: string[] = []
  const appBundleId = app.isPackaged ? 'com.ambientmind.app' : null
  if (!startHelper()) {
    return { ok: false, helper: null, appBundleId, permissions: [], problems: ['The helper binary is missing'] }
  }
  try {
    const hello = await helperRequest('hello', {}, { timeoutMs: 10_000 })
    const helperPerms = await helperRequest('perms.status', { kinds: ['microphone', 'screen', 'accessibility'] })
    const appView: Record<string, string> = {
      microphone: systemPreferences.getMediaAccessStatus('microphone'),
      screen: systemPreferences.getMediaAccessStatus('screen'),
      accessibility: systemPreferences.isTrustedAccessibilityClient(false) ? 'granted' : 'denied'
    }
    const permissions = Object.entries(appView).map(([kind, status]) => ({
      kind,
      app: status,
      helper: helperPerms[kind as keyof typeof helperPerms] ?? ('missing' as const)
    }))
    for (const permission of permissions) {
      if ((permission.app === 'granted') !== (permission.helper === 'granted')) {
        problems.push(`${permission.kind}: the app says ${permission.app}, the helper ${permission.helper}`)
      }
    }
    if (appBundleId && hello.responsibleApp !== appBundleId) {
      problems.push(`macOS holds ${hello.responsibleApp ?? 'nothing'} responsible for the helper, not ${appBundleId}`)
    }
    return {
      ok: problems.length === 0,
      helper: { version: hello.version, responsibleApp: hello.responsibleApp, parentApp: hello.parentApp },
      appBundleId,
      permissions,
      problems
    }
  } catch (err) {
    return { ok: false, helper: null, appBundleId, permissions: [], problems: [(err as Error).message] }
  } finally {
    await stopHelper()
  }
}
