/**
 * Starts and stops an unattended QA run (docs/AGENT_QA.md).
 *
 *   ./dev npm run qa -- start [name]   run folder, snapshot, seeded profiles, guard on
 *   ./dev npm run qa -- status
 *   ./dev npm run qa -- stop           guard off; nothing is deleted
 *
 * The live data folder is only ever read: the database through SQLite's
 * read-only backup, the rest by copying. Profiles live in <run>/profiles/.
 */
const { spawnSync, execFileSync } = require('node:child_process')
const { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')
const { randomUUID } = require('node:crypto')

const ROOT = join(__dirname, '..')
const LIVE = join(ROOT, '.local', 'data')
const QA = join(ROOT, '.local', 'qa')
const ACTIVE = join(QA, 'ACTIVE')
const SQLITE = '/usr/bin/sqlite3'

function sqlite(db, ...args) {
  const result = spawnSync(SQLITE, [db, ...args], { encoding: 'utf8' })
  if (result.status !== 0) throw new Error(`sqlite3 ${args.join(' ')}: ${result.stderr.trim()}`)
  return result.stdout.trim()
}

function today() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function newRunDir(name) {
  const base = join(QA, 'runs', name ? `${today()}-${name}` : today())
  let dir = base
  for (let n = 2; existsSync(dir); n++) dir = `${base}-${n}`
  mkdirSync(dir, { recursive: true })
  return dir
}

const SAFE_CONFIG = {
  onboarded: true,
  calendarWriteBack: false,
  remindersSync: false,
  appleCalendar: false,
  launchAtLogin: false,
  screenReading: false
}

function writeConfig(dir, base = {}) {
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ ...base, ...SAFE_CONFIG }, null, 2))
}

/** Your data, read-only: the database by SQLite backup, the rest by copy. */
function snapshot(dir) {
  mkdirSync(dir, { recursive: true })
  const db = join(dir, 'ambientmind.db')
  try {
    sqlite(`file:${join(LIVE, 'ambientmind.db')}?mode=ro`, `.backup '${db}'`)
  } catch (err) {
    console.warn(`[qa] read-only backup failed (${err.message}); trying an immutable read`)
    sqlite(`file:${join(LIVE, 'ambientmind.db')}?immutable=1`, `.backup '${db}'`)
  }
  const live = existsSync(join(LIVE, 'config.json')) ? JSON.parse(readFileSync(join(LIVE, 'config.json'), 'utf8')) : {}
  writeConfig(dir, live)
  for (const file of ['ai-calls.jsonl', 'secrets.json', 'google-credentials.json', 'chat-history.json', 'network.jsonl']) {
    if (existsSync(join(LIVE, file))) cpSync(join(LIVE, file), join(dir, file))
  }
  if (existsSync(join(LIVE, 'whisper'))) cpSync(join(LIVE, 'whisper'), join(dir, 'whisper'), { recursive: true })
  return {
    userVersion: Number(sqlite(db, 'PRAGMA user_version')),
    integrity: sqlite(db, 'PRAGMA integrity_check'),
    tasks: sqlite(db, "SELECT status || ':' || count(*) FROM tasks GROUP BY status").split('\n'),
    googleSignedIn: existsSync(join(dir, 'secrets.json'))
  }
}

const q = (value) => (value === null || value === undefined ? 'NULL' : `'${String(value).replace(/'/g, "''")}'`)
const at = (hours) => new Date(Date.now() + hours * 3_600_000).toISOString()

function taskRow(t) {
  return `INSERT INTO tasks (id, title, deadline, priority, source, source_id, people, raw_context, confidence, status, created_at, completed_at, snoozed_until, evidence)
VALUES (${q(t.id ?? randomUUID())}, ${q(t.title)}, ${q(t.deadline ?? null)}, ${q(t.priority ?? 'medium')}, ${q(t.source ?? 'manual')}, ${q(t.sourceId ?? null)}, ${q(JSON.stringify(t.people ?? []))}, ${q(t.rawContext ?? null)}, ${t.confidence ?? 1}, ${q(t.status ?? 'pending')}, ${q(t.createdAt ?? at(-24))}, ${q(t.completedAt ?? null)}, ${q(t.snoozedUntil ?? null)}, ${q(t.evidence ?? null)});`
}

function ruleRow(r) {
  return `INSERT INTO recurrence_rules (id, title, weekdays, time_of_day, priority, lead_minutes, enabled, created_at, source)
VALUES (${q(randomUUID())}, ${q(r.title)}, ${q(JSON.stringify(r.weekdays))}, ${q(r.time)}, 'medium', 0, ${r.enabled === false ? 0 : 1}, ${q(at(-200))}, 'explicit');`
}

function decisionRow(d) {
  return `INSERT INTO decisions (id, kind, subject, title, source, detail, decided_at)
VALUES (${q(randomUUID())}, ${q(d.kind)}, ${q(d.title.toLowerCase())}, ${q(d.title)}, ${q(d.source)}, NULL, ${q(d.at)});`
}

const VERBS = ['Reply to', 'Pay', 'Book', 'Review', 'Call', 'Send', 'Renew', 'Submit', 'Prepare', 'Pick up']
const OBJECTS = ['the electricity bill', 'Priya about the offsite', 'the dentist', 'the pull request from Daniel', 'mum', 'the invoice to Acme', 'the passport', 'the expense report', 'slides for Monday', 'the dry cleaning']
const SOURCES = ['gmail', 'gcalendar', 'manual', 'voice', 'chat', 'screen', 'rule']
const PRIORITIES = ['low', 'medium', 'high', 'urgent']

function generated(count, seed = 1) {
  let s = seed
  const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647)
  return Array.from({ length: count }, (_, i) => {
    const status = rand() < 0.65 ? 'pending' : rand() < 0.5 ? 'done' : rand() < 0.5 ? 'snoozed' : 'suggested'
    const source = SOURCES[Math.floor(rand() * SOURCES.length)]
    return {
      title: `${VERBS[i % VERBS.length]} ${OBJECTS[Math.floor(rand() * OBJECTS.length)]}${i >= 10 ? ` #${i}` : ''}`,
      deadline: rand() < 0.7 ? at(Math.round((rand() - 0.25) * 24 * 14)) : null,
      priority: PRIORITIES[Math.floor(rand() * PRIORITIES.length)],
      source,
      sourceId: source === 'gmail' || source === 'gcalendar' ? `qa-${seed}-${i}` : null,
      people: rand() < 0.3 ? ['Priya Raman'] : [],
      status,
      confidence: status === 'suggested' ? 0.55 + rand() * 0.4 : 1,
      completedAt: status === 'done' ? at(-rand() * 72) : null,
      snoozedUntil: status === 'snoozed' ? at(rand() * 48) : null,
      evidence: source === 'gmail' ? 'Could you get this to me by Friday?' : null
    }
  })
}

const ADVERSARIAL = [
  { title: 'A'.repeat(20) + ' very long title that keeps going '.repeat(12), deadline: at(2) },
  { title: '🎂 Order the cake for Aanya’s birthday 🎉🎈', deadline: at(30) },
  { title: 'اتصل بأحمد بخصوص العقد', deadline: at(5), people: ['أحمد'] },
  { title: 'להתקשר לדני לגבי השכירות', deadline: at(6) },
  { title: '<img src=x onerror="window.__pwned=1"> Pay rent', deadline: at(1) },
  { title: '**Bold** [click](javascript:window.__pwned=1) `code`', deadline: at(3) },
  { title: 'Line one\nLine two\nLine three', deadline: at(8) },
  { title: 'Zero\u200bwidth\u200bspaces\u200b here', deadline: null },
  { title: 'Overdue by a month', deadline: at(-24 * 30), priority: 'urgent' },
  { title: 'Overdue by ten minutes', deadline: at(-0.17), priority: 'high' },
  { title: 'Due in five minutes', deadline: at(0.08) },
  { title: 'Standup with the team', deadline: at(4), source: 'gcalendar', sourceId: 'qa-clash-1' },
  { title: 'Dentist appointment', deadline: at(4), source: 'gcalendar', sourceId: 'qa-clash-2' },
  { title: 'Send the invoice to Acme', deadline: at(20), source: 'gmail', sourceId: 'qa-dup-1', evidence: 'Please send the invoice by Tuesday.' },
  { title: 'Send the invoice to Acme', deadline: at(20), source: 'manual' },
  { title: '   ', deadline: null },
  { title: 'Suggested with low confidence', status: 'suggested', confidence: 0.31, source: 'gmail', sourceId: 'qa-low-1', evidence: 'maybe we should sync sometime?' },
  { title: "Robert'); DROP TABLE tasks;--", deadline: at(12) }
]

/** A copy of the snapshot's schema with the user's rows removed, then seeded. */
function seededProfile(dir, snapshotDb, rows) {
  mkdirSync(dir, { recursive: true })
  const db = join(dir, 'ambientmind.db')
  sqlite(snapshotDb, `.backup '${db}'`)
  const tables = sqlite(db, "SELECT name FROM sqlite_master WHERE type='table'").split('\n')
  const wipe = ['task_links', 'tasks', 'recurrence_rules', 'recurrence_suggestions', 'decisions', 'processed_messages', 'sync_state']
    .filter((t) => tables.includes(t))
    .map((t) => `DELETE FROM ${t};`)
  // No VACUUM: the system sqlite3 lacks the vec0 module the vector table needs.
  const sql = ['BEGIN;', ...wipe, ...rows, 'COMMIT;'].join('\n')
  const seedFile = join(dir, 'seed.sql')
  writeFileSync(seedFile, sql)
  sqlite(db, `.read '${seedFile}'`)
  writeConfig(dir)
  return Number(sqlite(db, 'SELECT count(*) FROM tasks'))
}

function helperWrapper(runDir) {
  const electron = require('electron')
  const path = join(runDir, 'fake-helper.sh')
  writeFileSync(path, `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec "${electron}" "${join(ROOT, 'eval', 'fixtures', 'fake-helper.cjs')}" ok\n`, { mode: 0o755 })
  return path
}

function start(name) {
  if (existsSync(ACTIVE)) {
    console.error(`[qa] a run is already active: ${readFileSync(ACTIVE, 'utf8').trim()}. Stop it first.`)
    process.exit(1)
  }
  const run = newRunDir(name)
  writeFileSync(ACTIVE, run)
  const profiles = join(run, 'profiles')
  const snap = snapshot(join(profiles, 'snapshot'))
  const snapshotDb = join(profiles, 'snapshot', 'ambientmind.db')

  mkdirSync(join(profiles, 'empty'), { recursive: true })
  writeFileSync(join(profiles, 'empty', 'config.json'), JSON.stringify({ ...SAFE_CONFIG, onboarded: false }, null, 2))

  const typical = seededProfile(join(profiles, 'typical'), snapshotDb, [
    ...generated(40, 7).map(taskRow),
    ...[
      { title: 'Water the plants', weekdays: [0, 3], time: '08:00' },
      { title: 'Tuition', weekdays: [2, 4, 6], time: '17:00' },
      { title: 'Gym', weekdays: [1, 3, 5], time: '07:00' },
      { title: 'Weekly review', weekdays: [5], time: '16:00' },
      { title: 'Call grandma', weekdays: [0], time: '11:00', enabled: false }
    ].map(ruleRow)
  ])
  const heavy = seededProfile(join(profiles, 'heavy'), snapshotDb, [
    ...generated(500, 11).map(taskRow),
    ...Array.from({ length: 30 }, (_, i) => ruleRow({ title: `Rule ${i + 1}`, weekdays: [i % 7, (i + 3) % 7], time: `${String(6 + (i % 14)).padStart(2, '0')}:30` })),
    ...Array.from({ length: 2000 }, (_, i) =>
      decisionRow({ kind: ['completed', 'deleted', 'snoozed', 'dismissed_suggestion'][i % 4], title: `${VERBS[i % 10]} ${OBJECTS[(i * 7) % 10]}`, source: SOURCES[i % 7], at: at(-i) })
    )
  ])
  const adversarial = seededProfile(join(profiles, 'adversarial'), snapshotDb, ADVERSARIAL.map(taskRow))

  const meta = {
    run,
    startedAt: new Date().toISOString(),
    commit: execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(),
    branch: execFileSync('git', ['branch', '--show-current'], { cwd: ROOT, encoding: 'utf8' }).trim(),
    helper: helperWrapper(run),
    snapshot: snap,
    profiles: { snapshot: snap.tasks, empty: 0, typical, heavy, adversarial }
  }
  writeFileSync(join(run, 'run.json'), JSON.stringify(meta, null, 2))
  for (const file of ['attempts-app.jsonl', 'attempts-agent.jsonl']) writeFileSync(join(run, file), '', { flag: 'a' })
  console.log(JSON.stringify(meta, null, 2))
}

function stop() {
  if (!existsSync(ACTIVE)) return console.log('[qa] no active run')
  const run = readFileSync(ACTIVE, 'utf8').trim()
  rmSync(ACTIVE)
  const metaFile = join(run, 'run.json')
  if (existsSync(metaFile)) {
    const meta = JSON.parse(readFileSync(metaFile, 'utf8'))
    writeFileSync(metaFile, JSON.stringify({ ...meta, stoppedAt: new Date().toISOString() }, null, 2))
  }
  console.log(`[qa] stopped ${run}`)
}

const [command, arg] = process.argv.slice(2)
if (command === 'start') start(arg)
else if (command === 'stop') stop()
else if (command === 'status') console.log(existsSync(ACTIVE) ? `active: ${readFileSync(ACTIVE, 'utf8').trim()}` : 'no active run')
else {
  console.error('usage: npm run qa -- start [name] | status | stop')
  process.exit(1)
}
