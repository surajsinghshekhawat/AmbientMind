import { existsSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from '@playwright/test'
import { activeRun, appendJsonl, launchQa, seed, startServer } from './harness'

/**
 * M8: soak (docs/AGENT_QA.md), shortened to QA_SOAK_MIN minutes. A sync every
 * two minutes against the fake Google, the panel opened and closed, and one
 * sample a minute of memory, CPU, live timers and handles.
 */

test.skip(!activeRun(), 'needs an active QA run')
const MINUTES = Number(process.env.QA_SOAK_MIN ?? 60)
test.setTimeout((MINUTES + 10) * 60_000)

test(`M8 soak for ${MINUTES} minutes`, async () => {
  const run = activeRun()!
  const google = await startServer('fake-google', ['--corpus', 'eval/corpus/seed.jsonl'])
  const qa = await launchQa({
    mission: 'm8',
    profile: 'typical',
    config: { displayName: 'Sally Beck' },
    env: { AMBIENTMIND_QA_GOOGLE: google.url },
    prepare: (dataDir) => seed(dataDir, 'delete from processed_messages; delete from sync_state;')
  })
  const samples = join(qa.out, 'samples.jsonl')
  const started = Date.now()
  try {
    for (let minute = 0; minute <= MINUTES; minute++) {
      const sample = await qa.app.evaluate(({ app, BrowserWindow }) => {
        const metrics = app.getAppMetrics()
        const resources = process.getActiveResourcesInfo()
        return {
          memMb: Math.round(metrics.reduce((s, m) => s + m.memory.workingSetSize, 0) / 1024),
          mainMb: Math.round(process.memoryUsage().rss / 1048576),
          heapMb: Math.round(process.memoryUsage().heapUsed / 1048576),
          cpu: Math.round(metrics.reduce((s, m) => s + m.cpu.percentCPUUsage, 0) * 10) / 10,
          processes: metrics.length,
          windows: BrowserWindow.getAllWindows().length,
          timers: resources.filter((r) => r === 'Timeout').length,
          handles: resources.length
        }
      })
      const file = (name: string) => (existsSync(join(qa.dataDir, name)) ? statSync(join(qa.dataDir, name)).size : 0)
      appendJsonl(samples, { minute, at: new Date().toISOString(), ...sample, aiLogBytes: file('ai-calls.jsonl'), netLogBytes: file('network.jsonl'), dbBytes: file('ambientmind.db') + file('ambientmind.db-wal') })
      if (minute === MINUTES) break
      if (minute % 2 === 0) await qa.action('syncNow').catch((err: Error) => appendJsonl(samples, { minute, syncError: err.message }))
      if (minute % 5 === 1) {
        await qa.action('expand', true)
        await new Promise((r) => setTimeout(r, 2000))
        await qa.action('expand', false)
      }
      const next = started + (minute + 1) * 60_000
      await new Promise((r) => setTimeout(r, Math.max(0, next - Date.now())))
    }
  } finally {
    writeFileSync(join(run, 'soak-done.json'), JSON.stringify({ minutes: MINUTES, endedAt: new Date().toISOString() }))
    await qa.close()
    google.stop()
  }
})
