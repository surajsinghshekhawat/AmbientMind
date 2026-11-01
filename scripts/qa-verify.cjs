/**
 * Morning checks for a QA run (docs/AGENT_QA.md, section 10). Read-only: it
 * reports, it never repairs.
 *
 *   ./dev npm run qa:verify [-- <run folder>]
 *
 * Writes <run>/verify.json and prints a summary. Exit code 1 if anything that
 * must hold (live data intact, nothing outside the repo, release/ untouched,
 * no mail text in the app's own logs) does not.
 */
const { spawnSync } = require('node:child_process')
const { existsSync, readdirSync, readFileSync, statSync, writeFileSync } = require('node:fs')
const { join, relative } = require('node:path')

const ROOT = join(__dirname, '..')
const QA = join(ROOT, '.local', 'qa')
const LIVE = join(ROOT, '.local', 'data')

function latestRun() {
  if (existsSync(join(QA, 'ACTIVE'))) return readFileSync(join(QA, 'ACTIVE'), 'utf8').trim()
  const runs = join(QA, 'runs')
  const names = readdirSync(runs).filter((n) => existsSync(join(runs, n, 'run.json')))
  names.sort((a, b) => statSync(join(runs, b)).mtimeMs - statSync(join(runs, a)).mtimeMs)
  return join(runs, names[0])
}

const run = process.argv[2] ? join(ROOT, process.argv[2]) : latestRun()
const meta = JSON.parse(readFileSync(join(run, 'run.json'), 'utf8'))
const startedAt = Date.parse(meta.startedAt)
const checks = []
const check = (name, ok, detail) => checks.push({ name, ok, detail })

function sqlite(db, sql) {
  const r = spawnSync('/usr/bin/sqlite3', [`file:${db}?immutable=1`, sql], { encoding: 'utf8' })
  return r.status === 0 ? r.stdout.trim() : `error: ${r.stderr.trim()}`
}

function walk(dir, out = []) {
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)
    if (entry.isSymbolicLink()) continue
    if (entry.isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}

// 1. Your live data: intact, and what changed while the run went on.
const liveDb = join(LIVE, 'ambientmind.db')
const integrity = sqlite(liveDb, 'pragma integrity_check')
const version = sqlite(liveDb, 'pragma user_version')
const counts = sqlite(liveDb, "select status || ':' || count(*) from tasks group by status").split('\n')
check('live database integrity', integrity === 'ok', { integrity, version, counts, atStart: meta.snapshot })
const touched = walk(LIVE)
  .filter((p) => !p.includes(`${join(LIVE, 'whisper')}`))
  .filter((p) => statSync(p).mtimeMs > startedAt)
  .map((p) => relative(LIVE, p))
check('live data folder changes during the run (your own app, if it ran)', true, touched)

// 2. Nothing outside the repo.
const doctor = spawnSync(join(ROOT, 'dev'), ['doctor'], { cwd: ROOT, encoding: 'utf8' })
check('./dev doctor', doctor.status === 0, (doctor.stdout + doctor.stderr).trim().split('\n'))

// 3. release/ untouched.
const releaseChanged = walk(join(ROOT, 'release'))
  .filter((p) => statSync(p).mtimeMs > startedAt)
  .map((p) => relative(ROOT, p))
check('release/ untouched', releaseChanged.length === 0, releaseChanged.slice(0, 20))

// 4. Git: same branch and commit as at the start.
const head = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim()
const branch = spawnSync('git', ['branch', '--show-current'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim()
// A resumed run (qa -- resume) is checked against the commit it resumed on.
const since = meta.resumes?.at(-1) ?? meta
check('git branch and commit unchanged', head === since.commit && branch === since.branch, { start: `${since.branch}@${since.commit}`, now: `${branch}@${head}` })

// 5. What the app and the agent tried.
const attemptFiles = walk(run).filter((p) => p.endsWith('attempts-app.jsonl'))
const kinds = {}
const blockedHosts = {}
const notable = []
for (const file of attemptFiles) {
  for (const line of readFileSync(file, 'utf8').split('\n').filter(Boolean)) {
    const a = JSON.parse(line)
    kinds[a.kind] = (kinds[a.kind] ?? 0) + 1
    if (a.kind.startsWith('network') && a.blocked) {
      const host = (() => {
        try {
          return new URL(a.detail.url).host
        } catch {
          return String(a.detail.url)
        }
      })()
      const key = `${a.detail.method} ${host}`
      blockedHosts[key] = (blockedHosts[key] ?? 0) + 1
    }
    if (['app.setLoginItemSettings', 'app.relaunch', 'shell.trashItem'].includes(a.kind)) notable.push({ file: relative(run, file), ...a })
  }
}
const googleWrites = Object.keys(blockedHosts).filter((k) => /google/.test(k))
check('no Google call that is not a read', googleWrites.length === 0, { blockedHosts })
check('what QA mode recorded instead of doing', true, { kinds, notable: notable.slice(0, 10) })
const agentLog = join(run, 'attempts-agent.jsonl')
const agent = existsSync(agentLog) ? readFileSync(agentLog, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []
// The guard logs refusals only.
check('agent commands the guard refused', true, agent.map((a) => ({ at: a.at, tool: a.tool ?? a.event, what: a.path ?? a.command, reason: a.reason })))

// 6. No mail text in the app's own files (its logs, not the harness's).
const corpus = readFileSync(join(ROOT, 'eval', 'corpus', 'seed.jsonl'), 'utf8')
  .split('\n')
  .filter((l) => l.trim().startsWith('{'))
  .map((l) => JSON.parse(l))
const needles = corpus.flatMap((m) => [m.subject, m.body.replace(/\s+/g, ' ').slice(10, 60)]).filter((s) => s && s.length > 12)
const appLogs = walk(join(run, 'work')).filter((p) => /\/data\/(network\.jsonl|ai-calls\.jsonl|crash\.log|chat-history\.json)$/.test(p) && !p.includes('/profiles/'))
const leaks = []
for (const file of appLogs) {
  const text = readFileSync(file, 'utf8').replace(/\s+/g, ' ')
  for (const needle of needles) if (text.includes(needle)) leaks.push({ file: relative(run, file), text: needle.slice(0, 40) })
}
check('no mail text in the app’s logs', leaks.filter((l) => !l.file.endsWith('chat-history.json')).length === 0, leaks.slice(0, 20))

const failed = checks.filter((c) => !c.ok)
writeFileSync(join(run, 'verify.json'), JSON.stringify({ run, checkedAt: new Date().toISOString(), checks }, null, 2))
for (const c of checks) console.log(`${c.ok ? '  ok  ' : '  FAIL'}  ${c.name}`)
console.log(`\n${relative(ROOT, join(run, 'verify.json'))}`)
process.exit(failed.length ? 1 : 0)
