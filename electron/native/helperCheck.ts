import { app, systemPreferences } from 'electron'
import type { AppleModelStatus, HelperAccess } from '@shared/helperProtocol'
import { helperHas, helperRequest, startHelper, stopHelper } from './helper'

export interface HelperCheck {
  ok: boolean
  helper: { version: string; responsibleApp: string | null; parentApp: string | null } | null
  appBundleId: string | null
  /** Each permission as the app sees it and as the helper sees it. */
  permissions: { kind: string; app: string; helper: HelperAccess | 'missing' }[]
  /** Apple's on-device model as the signed helper sees it; `answeredMs` once it replied. */
  appleModel: (AppleModelStatus & { answeredMs?: number }) | null
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
    return { ok: false, helper: null, appBundleId, permissions: [], appleModel: null, problems: ['The helper binary is missing'] }
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
    let appleModel: HelperCheck['appleModel'] = null
    if (helperHas('llm')) {
      appleModel = await helperRequest('llm.status', {})
      // Ineligible Macs are fine; a model that says it's ready must answer.
      if (appleModel.available) {
        try {
          const reply = await helperRequest('llm.generate', { prompt: 'Reply with the word ok.', maxTokens: 8 }, { timeoutMs: 60_000 })
          appleModel = { ...appleModel, answeredMs: reply.ms }
        } catch (err) {
          problems.push(`Apple's model is ready but did not answer: ${(err as Error).message}`)
        }
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
      appleModel,
      problems
    }
  } catch (err) {
    return { ok: false, helper: null, appBundleId, permissions: [], appleModel: null, problems: [(err as Error).message] }
  } finally {
    await stopHelper()
  }
}
