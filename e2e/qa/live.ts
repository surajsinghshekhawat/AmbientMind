import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { activeRun, ROOT, until } from './harness'

/**
 * Live runs (docs/AGENT_QA.md, "Live mission"): the QA build under its own
 * identity, com.ambientmind.qa, with the real helper, Reminders, Calendar and
 * Google. Opened through LaunchServices so macOS asks on its behalf rather
 * than Cursor's, and driven over QA mode's loopback control endpoint.
 */

export const LIVE_APP = join(ROOT, '.local', 'qa', 'build', 'live', 'mac-arm64', 'AmbientMind QA.app')

/** What ./dev packaged passes through, so the app stays inside the repo. */
const PASSED_ENV = [
  'AMBIENTMIND_ISOLATED',
  'AMBIENTMIND_ROOT',
  'AMBIENTMIND_REAL_HOME',
  'HOME',
  'CFFIXED_USER_HOME',
  'TMPDIR',
  'XDG_CACHE_HOME',
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME',
  'XDG_STATE_HOME',
  'OLLAMA_HOST',
  'OLLAMA_URL'
]

const SAFE = { calendarWriteBack: false, remindersSync: false, appleCalendar: false, launchAtLogin: false, screenReading: false }

export interface LiveApp {
  out: string
  dataDir: string
  pid: number
  /** Main-process output so far, as lines. */
  log: () => string[]
  action: <T = unknown>(name: string, ...args: unknown[]) => Promise<T>
  /** Evaluates `script` in a window, where `ambient` is its preload API. */
  api: <T = unknown>(script: string, kind?: string) => Promise<T>
  close: () => Promise<void>
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

export async function launchLive(variant: string, config: Record<string, unknown> = {}): Promise<LiveApp> {
  const run = activeRun()
  if (!run) throw new Error('Set QA_RUN to a run folder')
  if (!existsSync(LIVE_APP)) throw new Error(`No live build at ${LIVE_APP}`)
  const work = join(run, 'work', `live-${variant}`)
  const dataDir = join(work, 'data')
  if (existsSync(dataDir)) throw new Error(`${dataDir} already used`)
  const out = join(run, 't3-live', variant)
  mkdirSync(dataDir, { recursive: true })
  mkdirSync(out, { recursive: true })

  // A fresh database: the snapshot's knows your real reminders and lists.
  const snapshot = join(run, 'profiles', 'snapshot')
  for (const file of ['secrets.json', 'google-credentials.json']) {
    if (existsSync(join(snapshot, file))) copyFileSync(join(snapshot, file), join(dataDir, file))
  }
  if (existsSync(join(snapshot, 'whisper'))) symlinkSync(join(snapshot, 'whisper'), join(dataDir, 'whisper'))
  const base = JSON.parse(readFileSync(join(snapshot, 'config.json'), 'utf8')) as Record<string, unknown>
  writeFileSync(join(dataDir, 'config.json'), JSON.stringify({ ...base, ...SAFE, ...config, onboarded: true }, null, 2))

  const controlFile = join(work, 'control.json')
  const logFile = join(out, 'main.log')
  const env: Record<string, string> = {}
  for (const name of PASSED_ENV) if (process.env[name]) env[name] = process.env[name]!
  Object.assign(env, {
    AMBIENTMIND_QA: '1',
    AMBIENTMIND_QA_LIVE: '1',
    AMBIENTMIND_DATA_DIR: dataDir,
    AMBIENTMIND_QA_LOG: join(out, 'attempts-app.jsonl'),
    AMBIENTMIND_QA_CONTROL: controlFile
  })
  const args = ['-n', '-g', '-a', LIVE_APP, '--stdout', logFile, '--stderr', logFile]
  for (const [name, value] of Object.entries(env)) args.push('--env', `${name}=${value}`)
  const opened = spawnSync('/usr/bin/open', args, { encoding: 'utf8' })
  if (opened.status !== 0) throw new Error(`open: ${opened.stderr.trim()}`)

  const ready = await until(() => existsSync(controlFile), 60_000)
  if (!ready) throw new Error(`The live app never wrote ${controlFile}; see ${logFile}`)
  const { port, token, pid } = JSON.parse(readFileSync(controlFile, 'utf8')) as { port: number; token: string; pid: number }

  const action = async <T>(name: string, ...rest: unknown[]): Promise<T> => {
    const response = await fetch(`http://127.0.0.1:${port}/action`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: JSON.stringify({ name, args: rest })
    })
    const body = (await response.json()) as { result?: T; error?: string }
    if (!response.ok) throw new Error(`${name}: ${body.error}`)
    return body.result as T
  }
  const api = <T>(script: string, kind = 'overlay') =>
    action<T>('renderer', kind, `(async () => { const ambient = window.ambient; return (${script}) })()`)

  // Actions are registered once the windows exist.
  const registered = await until(() => api('true').then(() => true, () => false), 60_000, 500)
  if (!registered) throw new Error(`The live app never registered its QA actions; see ${logFile}`)

  return {
    out,
    dataDir,
    pid,
    log: () => (existsSync(logFile) ? readFileSync(logFile, 'utf8').split('\n').filter(Boolean) : []),
    action,
    api,
    close: async () => {
      await action('quit').catch(() => {})
      if (!(await until(() => !alive(pid), 20_000, 250))) process.kill(pid, 'SIGTERM')
    }
  }
}
