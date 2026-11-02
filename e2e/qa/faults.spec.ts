import { chmodSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from '@playwright/test'
import { activeRun, appendJsonl, launchQa, PageWatch, query, seed, startServer, until, type LaunchOptions, type QaApp } from './harness'

/**
 * M5: failure under faults (docs/AGENT_QA.md). Each case injects one fault,
 * records what the sync or the screen reported, then removes the fault and
 * checks the next pass recovers with nothing lost.
 */

test.skip(!activeRun(), 'needs an active QA run')
test.setTimeout(20 * 60_000)

interface SyncReport {
  scanned: number
  extracted: number
  added: number
  errors: string[]
}

const WIPE_SYNC = `delete from task_links; delete from tasks where source in ('gmail','gcalendar'); delete from processed_messages; delete from sync_state;`
const results = () => join(activeRun()!, 'faults.jsonl')

async function replay(variant: string, extra: Partial<LaunchOptions> = {}) {
  const run = activeRun()!
  const google = await startServer('fake-google', ['--corpus', 'eval/corpus/seed.jsonl', '--log', join(run, `fake-google-${variant}.jsonl`)])
  const ollama = await startServer('ollama-faults', ['--log', join(run, `ollama-faults-${variant}.jsonl`)])
  const qa = await launchQa({
    mission: 'm5',
    profile: 'typical',
    variant,
    config: { displayName: 'Sally Beck', aboutMe: '' },
    env: { AMBIENTMIND_QA_GOOGLE: google.url, OLLAMA_URL: ollama.url },
    prepare: (dataDir) => seed(dataDir, WIPE_SYNC),
    ...extra
  })
  return { qa, google, ollama }
}

async function sync(qa: QaApp) {
  const t = Date.now()
  try {
    const report = (await qa.action('syncNow')) as SyncReport
    return { ms: Date.now() - t, report, threw: null as string | null }
  } catch (err) {
    return { ms: Date.now() - t, report: null, threw: (err as Error).message.split('\n')[0]! }
  }
}

const gmailTasks = (qa: QaApp) => query<{ n: number }>(qa.dataDir, "select count(*) n from tasks where source = 'gmail'")[0]!.n

async function overlayShot(qa: QaApp, name: string) {
  await qa.action('expand', true)
  const page = await qa.window('overlay')
  await page.waitForTimeout(600)
  await page.screenshot({ path: join(qa.out, `${name}.png`) })
}

const CASES: { name: string; target: 'ollama' | 'google'; mode: string; times: number; paths?: string }[] = [
  { name: 'ollama-500', target: 'ollama', mode: '500', times: 4, paths: '/api/chat' },
  { name: 'ollama-drop', target: 'ollama', mode: 'drop', times: 4, paths: '/api/chat' },
  { name: 'ollama-malformed', target: 'ollama', mode: 'malformed', times: 4, paths: '/api/chat' },
  { name: 'ollama-slow', target: 'ollama', mode: 'slow', times: 2, paths: '/api/chat' },
  { name: 'ollama-hang', target: 'ollama', mode: 'hang', times: 1, paths: '/api/chat' },
  { name: 'ollama-down', target: 'ollama', mode: '500', times: -1 },
  { name: 'google-500', target: 'google', mode: '500', times: 1 },
  { name: 'google-429', target: 'google', mode: '429', times: 3 },
  { name: 'google-malformed', target: 'google', mode: 'malformed', times: 1 },
  { name: 'google-drop', target: 'google', mode: 'drop', times: 2 }
]

for (const c of CASES) {
  test(`M5 ${c.name}`, async () => {
    const { qa, google, ollama } = await replay(c.name)
    const watch = new PageWatch(await qa.window('overlay'))
    try {
      await (c.target === 'ollama' ? ollama : google).fault(c.mode, c.times, c.paths ?? '')
      const faulted = await sync(qa)
      const afterFault = gmailTasks(qa)
      await overlayShot(qa, 'during')
      await (c.target === 'ollama' ? ollama : google).fault('none', 0)
      const recovered = await sync(qa)
      const afterRecovery = gmailTasks(qa)
      await overlayShot(qa, 'after')
      const failedIds = query<{ n: number }>(qa.dataDir, "select count(*) n from processed_messages where outcome = 'failed'")[0]!.n
      const entry = { case: c.name, faulted, afterFault, recovered, afterRecovery, failedIdsLeft: failedIds, consoleErrors: watch.errors.slice(0, 5) }
      appendJsonl(results(), entry)
      if (faulted.threw) qa.candidate({ severity: 'S2', title: `${c.name}: Sync now threw instead of reporting`, detail: faulted.threw })
      if (afterRecovery < 7) qa.candidate({ severity: 'S2', title: `${c.name}: after the fault cleared, only ${afterRecovery} of 7 mail tasks came back`, detail: entry })
    } finally {
      await qa.close()
      google.stop()
      ollama.stop()
    }
  })
}

test('M5 helper that never answers, and one that crashes at start', async () => {
  const run = activeRun()!
  const base = readFileSync(join(run, 'fake-helper.sh'), 'utf8')
  for (const mode of ['mute', 'crash-first']) {
    const script = join(run, `fake-helper-${mode}.sh`)
    writeFileSync(script, base.replace(/ ok\s*$/, mode === 'crash-first' ? ` crash-first "${join(run, 'helper-crash-count')}"\n` : ' mute\n'))
    chmodSync(script, 0o755)
    const qa = await launchQa({ mission: 'm5', profile: 'typical', variant: `helper-${mode}`, env: { AMBIENTMIND_HELPER: script } })
    try {
      await qa.action('quickAdd')
      const box = (await qa.window('quickadd')).getByRole('textbox', { name: 'What needs doing?' })
      await box.fill('Helper fault probe tomorrow 9am')
      await box.press('Enter')
      const saved = await until(() => query(qa.dataDir, "select 1 from tasks where title like 'Helper fault probe%'").length > 0, 30_000)
      await overlayShot(qa, 'overlay')
      const entry = { case: `helper-${mode}`, quickAddWorked: saved, helperLog: qa.mainLog.filter((l) => l.startsWith('[helper]')).slice(0, 12) }
      appendJsonl(results(), entry)
      if (!saved) qa.candidate({ severity: 'S2', title: `Quick add fails when the helper is ${mode}`, detail: entry })
    } finally {
      await qa.close()
    }
  }
})

test('M5 a corrupted config file', async () => {
  const qa = await launchQa({
    mission: 'm5',
    profile: 'typical',
    variant: 'bad-config',
    prepare: (dataDir) => writeFileSync(join(dataDir, 'config.json'), '{"onboarded": true, "theme": "dark", "syncIntervalMinutes": ')
  }).catch((err: Error) => err)
  if (qa instanceof Error) {
    appendJsonl(results(), { case: 'bad-config', started: false, error: qa.message.split('\n')[0] })
    throw qa
  }
  try {
    const overlay = await qa.window('overlay')
    await overlay.screenshot({ path: join(qa.out, 'overlay.png') })
    const windows = qa.app.windows().map((w) => w.url().split('/').slice(-2)[0])
    const config = readFileSync(join(qa.dataDir, 'config.json'), 'utf8')
    appendJsonl(results(), { case: 'bad-config', started: true, windows, configNow: config.slice(0, 200), log: qa.mainLog.filter((l) => /config/i.test(l)).slice(0, 5) })
  } finally {
    await qa.close()
  }
})
