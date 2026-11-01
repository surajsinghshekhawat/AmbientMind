import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { appendFileSync, copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'

/**
 * Shared pieces of the QA missions (docs/AGENT_QA.md). Every launch is in QA
 * mode on a fresh copy of one seeded profile, inside the active run folder.
 */

export const ROOT = join(__dirname, '..', '..')
const ACTIVE = join(ROOT, '.local', 'qa', 'ACTIVE')
const electronBinary = require('electron') as unknown as string

/** The active run folder, or null outside a run (the missions then skip). */
export function activeRun(): string | null {
  if (process.env.QA_RUN) return process.env.QA_RUN
  return existsSync(ACTIVE) ? readFileSync(ACTIVE, 'utf8').trim() : null
}

export type Target = 'dev' | 'packaged'
export const TARGET: Target = process.env.QA_TARGET === 'packaged' ? 'packaged' : 'dev'
const PACKAGED = join(ROOT, '.local', 'qa', 'build', 'mac-arm64', 'AmbientMind.app', 'Contents', 'MacOS', 'AmbientMind')

export type WindowKind = 'overlay' | 'quickadd' | 'settings' | 'chat' | 'onboarding'

export interface LaunchOptions {
  mission: string
  profile: string
  /** Distinguishes several launches of one profile in a mission. */
  variant?: string
  config?: Record<string, unknown>
  env?: Record<string, string>
  /** Runs on the fresh copy before the app starts. */
  prepare?: (dataDir: string) => void
  /** Starts again on this launch's data instead of a fresh copy. */
  reuse?: QaApp
}

export interface QaApp {
  app: ElectronApplication
  run: string
  /** <run>/<target>/<mission>/<profile>[-variant]: logs and screenshots. */
  out: string
  dataDir: string
  /** Main-process stdout and stderr, as lines. */
  mainLog: string[]
  exited: () => boolean
  window: (kind: WindowKind, timeoutMs?: number) => Promise<Page>
  action: (name: string, ...args: unknown[]) => Promise<unknown>
  attempts: () => Promise<{ kind: string; blocked: boolean; detail: Record<string, unknown> }[]>
  candidate: (finding: Candidate) => void
  close: () => Promise<void>
}

/** A possible finding; the morning review turns real ones into findings.json. */
export interface Candidate {
  severity: 'S1' | 'S2' | 'S3' | 'S4'
  title: string
  screen?: string
  evidence?: string[]
  detail?: unknown
}

const SAFE = {
  calendarWriteBack: false,
  remindersSync: false,
  appleCalendar: false,
  launchAtLogin: false,
  screenReading: false
}

function prepareData(run: string, options: LaunchOptions, dataDir: string) {
  if (existsSync(dataDir)) throw new Error(`${dataDir} already used; give the launch a variant`)
  cpSync(join(run, 'profiles', options.profile), dataDir, { recursive: true, filter: (src) => !src.endsWith('/whisper') })
  // Every profile is "set up": the OAuth client (not a token) and the speech
  // model come from the snapshot. The model is shared, not copied per launch.
  const snapshot = join(run, 'profiles', 'snapshot')
  const client = join(snapshot, 'google-credentials.json')
  if (existsSync(client) && !existsSync(join(dataDir, 'google-credentials.json'))) copyFileSync(client, join(dataDir, 'google-credentials.json'))
  if (existsSync(join(snapshot, 'whisper'))) symlinkSync(join(snapshot, 'whisper'), join(dataDir, 'whisper'))
  const configPath = join(dataDir, 'config.json')
  const config = JSON.parse(readFileSync(configPath, 'utf8')) as Record<string, unknown>
  writeFileSync(configPath, JSON.stringify({ ...config, ...options.config, ...SAFE }, null, 2))
  options.prepare?.(dataDir)
}

/** Reads a launch's database; read-only, so it's safe while the app has it open. */
export function query<T = Record<string, unknown>>(dataDir: string, sql: string): T[] {
  const result = spawnSync('/usr/bin/sqlite3', ['-json', `file:${join(dataDir, 'ambientmind.db')}?mode=ro`, sql], { encoding: 'utf8' })
  if (result.status !== 0) throw new Error(`sqlite3: ${result.stderr.trim()}`)
  return result.stdout.trim() ? (JSON.parse(result.stdout) as T[]) : []
}

/** Writes to a launch's database before the app starts (prepare hooks only). */
export function seed(dataDir: string, sql: string) {
  const result = spawnSync('/usr/bin/sqlite3', [join(dataDir, 'ambientmind.db'), sql], { encoding: 'utf8' })
  if (result.status !== 0) throw new Error(`sqlite3: ${result.stderr.trim()}`)
}

export async function until<T>(probe: () => T | Promise<T>, timeoutMs = 15_000, everyMs = 250): Promise<T> {
  const deadline = Date.now() + timeoutMs
  let last: T = await probe()
  while (!last && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, everyMs))
    last = await probe()
  }
  return last
}

export async function launchQa(options: LaunchOptions): Promise<QaApp> {
  const run = activeRun()
  if (!run) throw new Error('No active QA run: ./dev npm run qa -- start')
  const name = options.variant ? `${options.profile}-${options.variant}` : options.profile
  const out = options.reuse?.out ?? join(run, TARGET === 'packaged' ? 't2-packaged' : 't1-dev', options.mission, name)
  // The data folder sits under work/ so QA mode's folder check sees <run>/<sub>.
  const dataDir = options.reuse?.dataDir ?? join(run, 'work', `${TARGET}-${options.mission}-${name}`, 'data')
  mkdirSync(out, { recursive: true })
  if (!options.reuse) prepareData(run, options, dataDir)

  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    AMBIENTMIND_QA: '1',
    AMBIENTMIND_DATA_DIR: dataDir,
    AMBIENTMIND_QA_LOG: join(out, 'attempts-app.jsonl'),
    AMBIENTMIND_HELPER: join(run, 'fake-helper.sh'),
    ...(process.env.QA_OLLAMA_URL ? { OLLAMA_URL: process.env.QA_OLLAMA_URL } : {}),
    ...options.env
  }
  const app = await electron.launch(
    TARGET === 'packaged' ? { executablePath: PACKAGED, env } : { executablePath: electronBinary, args: ['.'], cwd: ROOT, env }
  )
  const mainLog: string[] = []
  const logFile = join(out, 'main.log')
  const onOutput = (chunk: Buffer) => {
    const text = chunk.toString()
    appendFileSync(logFile, text)
    mainLog.push(...text.split('\n').filter(Boolean))
  }
  app.process().stdout?.on('data', onOutput)
  app.process().stderr?.on('data', onOutput)
  let exited = false
  app.process().on('exit', (code, signal) => {
    exited = true
    appendFileSync(logFile, `\n[harness] app exited: code ${code} signal ${signal}\n`)
  })

  const candidatesFile = join(out, 'candidates.jsonl')
  const qa: QaApp = {
    app,
    run,
    out,
    dataDir,
    mainLog,
    exited: () => exited,
    window: async (kind, timeoutMs = 15_000) => {
      const deadline = Date.now() + timeoutMs
      while (Date.now() < deadline) {
        for (const page of app.windows().filter((p) => !p.isClosed() && p.url().includes(`/${kind}/`))) {
          // A window that is closing still answers isClosed() with false.
          const alive = await page.evaluate(() => document.readyState).catch(() => null)
          if (alive) return page
        }
        await new Promise((r) => setTimeout(r, 150))
      }
      throw new Error(`No ${kind} window after ${timeoutMs} ms`)
    },
    action: (actionName, ...args) =>
      app.evaluate(
        async (_electron, [n, a]) => {
          const fn = globalThis.__qa?.actions[n as string]
          if (!fn) throw new Error(`QA action ${n} is not registered`)
          const result = await fn(...(a as unknown[]))
          // Windows and other live objects don't cross; plain data does.
          return result !== null && typeof result === 'object' && result.constructor !== Object && !Array.isArray(result)
            ? null
            : (result ?? null)
        },
        [actionName, args] as const
      ),
    attempts: () => app.evaluate(() => globalThis.__qa?.attempts ?? []),
    candidate: (finding) => appendFileSync(candidatesFile, `${JSON.stringify({ at: new Date().toISOString(), ...finding })}\n`),
    close: async () => {
      await app.close().catch(() => {})
    }
  }
  // QA mode registers its actions once the windows exist.
  await qa.window('overlay', 30_000)
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    const ready = await app.evaluate(() => Object.keys(globalThis.__qa?.actions ?? {}).length > 0).catch(() => false)
    if (ready) break
    await new Promise((r) => setTimeout(r, 200))
  }
  return qa
}

export function hashOf(buffer: Buffer): string {
  return createHash('sha1').update(buffer).digest('hex').slice(0, 12)
}

/** Collects renderer console errors and crashes per page, so a step can ask what's new. */
export class PageWatch {
  readonly errors: string[] = []
  crashed = false

  constructor(page: Page) {
    page.on('console', (msg) => {
      if (msg.type() === 'error') this.errors.push(msg.text())
    })
    page.on('pageerror', (err) => this.errors.push(`pageerror: ${err.message}`))
    page.on('crash', () => {
      this.crashed = true
    })
  }

  since(mark: number): string[] {
    return this.errors.slice(mark)
  }
}

const AXE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8')

export interface AxeViolation {
  id: string
  impact: string | null
  help: string
  nodes: number
  targets: string[]
}

/** Runs axe in the page. Injected through the devtools protocol, so the page's CSP doesn't apply. */
export async function axe(page: Page): Promise<AxeViolation[]> {
  await page.evaluate(`${AXE};void 0`)
  return page.evaluate(async () => {
    const w = window as unknown as { axe: { run: (ctx: Document, opts: object) => Promise<{ violations: any[] }> } }
    const result = await w.axe.run(document, { resultTypes: ['violations'] })
    return result.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      help: v.help,
      nodes: v.nodes.length,
      targets: v.nodes.slice(0, 5).map((n: { target: string[] }) => n.target.join(' '))
    }))
  })
}

export interface LocalServer {
  port: number
  url: string
  fault: (mode: string, times?: number, paths?: string) => Promise<void>
  stop: () => void
}

/** Starts scripts/fake-google.cjs or scripts/ollama-faults.cjs on a free port. */
export async function startServer(script: 'fake-google' | 'ollama-faults', args: string[]): Promise<LocalServer> {
  const child = spawn(process.execPath, [join(ROOT, 'scripts', `${script}.cjs`), '--port', '0', ...args], { cwd: ROOT, stdio: ['ignore', 'pipe', 'inherit'] })
  const port = await new Promise<number>((resolve, reject) => {
    child.once('exit', (code) => reject(new Error(`${script} exited with ${code}`)))
    child.stdout!.once('data', (chunk: Buffer) => resolve((JSON.parse(chunk.toString().split('\n')[0]!) as { port: number }).port))
  })
  const url = `http://127.0.0.1:${port}`
  return {
    port,
    url,
    fault: async (mode, times = 1, paths = '') => {
      await fetch(`${url}/__fault`, { method: 'POST', body: JSON.stringify({ mode, times, paths }) })
    },
    stop: () => child.kill()
  }
}

export function appendJsonl(file: string, value: unknown) {
  appendFileSync(file, `${JSON.stringify(value)}\n`)
}
