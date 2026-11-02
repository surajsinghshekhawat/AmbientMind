import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { _electron as electron, expect, test, type Page } from '@playwright/test'

/**
 * The idle budget: with only the overlay showing and nothing changing, the
 * app should cost next to nothing. Measures CPU over a quiet window after the
 * orb has settled, and memory per process, and writes both to
 * .local/idle-budget.json. Uses the packaged app when AMBIENTMIND_PACKAGED_APP
 * is set, else the dev build.
 */

const ROOT = join(__dirname, '..')
const DATA = join(ROOT, '.local', 'e2e-data')
const SETTLE_MS = 12_000
const SAMPLE_MS = 20_000
/** Summed across every Electron process and the helper. */
const MAX_IDLE_CPU_PERCENT = 2

function markOnboarded() {
  mkdirSync(DATA, { recursive: true })
  const file = join(DATA, 'config.json')
  const config = existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>) : {}
  writeFileSync(file, JSON.stringify({ ...config, onboarded: true }, null, 2))
}

function helperUsage(parent: number): { cpu: number; rssMb: number } | null {
  try {
    const pid = execFileSync('pgrep', ['-P', String(parent), '-x', 'ambientmind-helper'], { encoding: 'utf8' }).trim()
    if (!pid) return null
    const [cpu, rss] = execFileSync('ps', ['-o', '%cpu=,rss=', '-p', pid], { encoding: 'utf8' }).trim().split(/\s+/).map(Number)
    return { cpu: cpu ?? 0, rssMb: Math.round((rss ?? 0) / 1024) }
  } catch {
    return null
  }
}

test('an idle overlay costs next to nothing', async () => {
  test.setTimeout(SETTLE_MS + SAMPLE_MS + 60_000)
  markOnboarded()
  const executablePath = process.env.AMBIENTMIND_PACKAGED_APP
  const app = await electron.launch({
    ...(executablePath ? { executablePath } : { args: ['.'], cwd: ROOT }),
    env: { ...process.env, AMBIENTMIND_DATA_DIR: DATA }
  })
  const proc = app.process()
  try {
    const isOverlay = (page: Page) => page.url().includes('/overlay/index.html')
    const overlay = app.windows().find(isOverlay) ?? (await app.waitForEvent('window', { predicate: isOverlay }))
    await expect(overlay.getByRole('button', { name: /^AmbientMind: / })).toBeVisible()

    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS))
    // Each call reports CPU since the previous one; this one starts the window.
    await app.evaluate(({ app }) => app.getAppMetrics())
    await new Promise((resolve) => setTimeout(resolve, SAMPLE_MS))
    const metrics = await app.evaluate(({ app }) =>
      app.getAppMetrics().map((m) => ({
        type: m.type,
        name: m.name ?? null,
        cpu: Math.round(m.cpu.percentCPUUsage * 100) / 100,
        memoryMb: Math.round(m.memory.workingSetSize / 1024)
      }))
    )
    const helper = helperUsage(proc.pid!)
    const electronCpu = metrics.reduce((sum, m) => sum + m.cpu, 0)
    const result = {
      measuredAt: new Date().toISOString(),
      build: executablePath ? 'packaged' : 'dev',
      sampleSeconds: SAMPLE_MS / 1000,
      totalCpuPercent: Math.round((electronCpu + (helper?.cpu ?? 0)) * 100) / 100,
      totalMemoryMb: metrics.reduce((sum, m) => sum + m.memoryMb, 0) + (helper?.rssMb ?? 0),
      processes: metrics,
      helper
    }
    writeFileSync(join(ROOT, '.local', 'idle-budget.json'), `${JSON.stringify(result, null, 2)}\n`)
    console.log(`[idle] ${result.totalCpuPercent}% CPU, ${result.totalMemoryMb} MB across ${metrics.length} processes${helper ? ' + helper' : ''}`)
    for (const m of metrics) console.log(`[idle]   ${m.type.padEnd(10)} ${String(m.cpu).padStart(5)}%  ${m.memoryMb} MB${m.name ? `  ${m.name}` : ''}`)
    expect(result.totalCpuPercent).toBeLessThan(MAX_IDLE_CPU_PERCENT)
  } finally {
    await app.close().catch(() => proc.kill('SIGKILL'))
  }
})
