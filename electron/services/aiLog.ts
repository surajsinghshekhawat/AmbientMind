import { appendFileSync, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import type { AiCall, AiPurpose } from './ai'
import type { AiEngine } from '@shared/types'

/**
 * One JSON line per model call: which engine, how long, how big the prompt
 * was, and whether it failed or fell back. Read by `npm run ai:budget` and
 * Settings. No prompt text is kept, only its length.
 */

const KEEP_LINES = 2000
const TRIM_ABOVE_BYTES = 1_000_000

export function readCalls(path: string): AiCall[] {
  if (!existsSync(path)) return []
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as AiCall]
      } catch {
        return []
      }
    })
}

/** Returns the recorder to hand to `configureAi({ onCall })`. */
export function openAiLog(path: string): (call: AiCall) => void {
  try {
    if (existsSync(path) && statSync(path).size > TRIM_ABOVE_BYTES) {
      const kept = readFileSync(path, 'utf8').split('\n').filter(Boolean).slice(-KEEP_LINES)
      writeFileSync(path, `${kept.join('\n')}\n`)
    }
  } catch (err) {
    console.warn('[ai] could not trim the call log:', (err as Error).message)
  }
  return (call) => appendFileSync(path, `${JSON.stringify(call)}\n`)
}

export interface BudgetRow {
  purpose: AiPurpose
  engine: AiEngine
  calls: number
  failures: number
  fallbacks: number
  p50: number
  p95: number
  max: number
  avgPromptChars: number
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  return sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)]!
}

export function summariseCalls(calls: AiCall[]): BudgetRow[] {
  const groups = new Map<string, AiCall[]>()
  for (const call of calls) {
    const key = `${call.purpose}\u0000${call.engine}`
    groups.set(key, [...(groups.get(key) ?? []), call])
  }
  return [...groups.values()]
    .map((group) => {
      const ok = group.filter((call) => call.ok).map((call) => call.ms).sort((a, b) => a - b)
      return {
        purpose: group[0]!.purpose,
        engine: group[0]!.engine,
        calls: group.length,
        failures: group.filter((call) => !call.ok).length,
        fallbacks: group.filter((call) => call.fellBack).length,
        p50: percentile(ok, 0.5),
        p95: percentile(ok, 0.95),
        max: ok.at(-1) ?? 0,
        avgPromptChars: Math.round(group.reduce((sum, call) => sum + call.promptChars, 0) / group.length)
      }
    })
    .sort((a, b) => a.purpose.localeCompare(b.purpose) || a.engine.localeCompare(b.engine))
}
