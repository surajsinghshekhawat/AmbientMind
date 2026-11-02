import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from '@playwright/test'
import { activeRun, launchQa, query, until, type QaApp } from './harness'

/**
 * M4: real numbers (docs/AGENT_QA.md). Each is reported as p50 / p95 / max
 * with its sample size, on this Mac, while you were using it.
 */

test.skip(!activeRun(), 'needs an active QA run')
test.setTimeout(40 * 60_000)

const N = Number(process.env.QA_PERF_N ?? 8)

function stats(samples: number[]) {
  const s = [...samples].sort((a, b) => a - b)
  const at = (q: number) => s[Math.min(s.length - 1, Math.floor(q * s.length))] ?? 0
  return { n: s.length, p50: at(0.5), p95: at(0.95), max: s[s.length - 1] ?? 0 }
}

async function memoryMb(qa: QaApp) {
  const metrics = await qa.app.evaluate(({ app }) => app.getAppMetrics().map((m) => ({ type: m.type, kb: m.memory.workingSetSize, cpu: m.cpu.percentCPUUsage })))
  return { totalMb: Math.round(metrics.reduce((sum, m) => sum + m.kb, 0) / 1024), processes: metrics.length }
}

test('M4 timings and memory', async () => {
  const result: Record<string, unknown> = {}

  for (const profile of ['typical', 'heavy'] as const) {
    const cold: number[] = []
    const panel: number[] = []
    const quickAdd: number[] = []
    let memory: unknown = null
    for (let i = 0; i < N; i++) {
      const started = Date.now()
      const qa = await launchQa({ mission: 'm4', profile, variant: `run${i}` })
      try {
        const overlay = await qa.window('overlay')
        await overlay.getByRole('button', { name: /^AmbientMind/ }).waitFor()
        cold.push(Date.now() - started)

        for (let j = 0; j < 3; j++) {
          await qa.action('expand', false)
          await overlay.waitForTimeout(300)
          const t = Date.now()
          await qa.action('expand', true)
          await overlay.getByRole('region', { name: 'Tasks' }).waitFor()
          await overlay.getByRole('checkbox').first().waitFor()
          panel.push(Date.now() - t)
        }

        if (i < 4) {
          await qa.action('quickAdd')
          const box = (await qa.window('quickadd')).getByRole('textbox', { name: 'What needs doing?' })
          const title = `Perf probe ${profile} ${i} tomorrow 9am`
          await box.fill(title)
          const t = Date.now()
          await box.press('Enter')
          await until(() => query(qa.dataDir, "select 1 from tasks where title like 'Perf probe%'").length > 0, 60_000, 50)
          quickAdd.push(Date.now() - t)
        }
        if (i === 0) {
          await overlay.waitForTimeout(10_000)
          memory = await memoryMb(qa)
        }
      } finally {
        await qa.close()
      }
    }
    result[profile] = { coldStartToOrbMs: stats(cold), panelOpenMs: stats(panel), quickAddToSavedMs: stats(quickAdd), memoryAfter10s: memory }
  }

  // Chat answers through the project Ollama.
  const qa = await launchQa({ mission: 'm4', profile: 'typical', variant: 'chat' })
  const chat: number[] = []
  try {
    await qa.action('chat')
    const page = await qa.window('chat')
    const box = page.getByRole('textbox', { name: 'Message' })
    for (const question of ["What's urgent today?", 'What is due this week?', 'Anything about the dentist?']) {
      const before = (await page.getByRole('log').textContent())?.length ?? 0
      const t = Date.now()
      await box.fill(question)
      await box.press('Enter')
      await until(async () => {
        const busy = await page.getByRole('log').getAttribute('aria-busy')
        const len = (await page.getByRole('log').textContent())?.length ?? 0
        return busy !== 'true' && len > before + question.length + 10
      }, 180_000, 200)
      chat.push(Date.now() - t)
    }
  } finally {
    await qa.close()
  }
  result.chatAnswerMs = stats(chat)
  result.sizes = { typical: query(join(activeRun()!, 'profiles', 'typical'), 'select count(*) n from tasks')[0], heavy: query(join(activeRun()!, 'profiles', 'heavy'), 'select count(*) n from tasks')[0] }
  writeFileSync(join(activeRun()!, 'perf.json'), JSON.stringify(result, null, 2))
})
