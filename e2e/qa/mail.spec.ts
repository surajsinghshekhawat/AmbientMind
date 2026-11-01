import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { aggregate, pair, scoreMessage } from '../../eval/score'
import type { LabelledMessage } from '../../eval/types'
import { activeRun, launchQa, query, seed, startServer, type QaApp } from './harness'

/**
 * M3: the mail pipeline with the real model (docs/AGENT_QA.md). The labelled
 * half replays eval/corpus through a fake Google so the real sync, extraction,
 * dedup and suggestion code runs end to end; the live half syncs your real
 * Gmail and Calendar through QA mode's read-only filter.
 */

test.skip(!activeRun(), 'needs an active QA run')
test.setTimeout(30 * 60_000)

interface SyncReport {
  scanned: number
  skipped: number
  extracted: number
  added: number
  deduped: number
  suppressed: number
  errors: string[]
}

interface Row {
  id: string
  title: string
  status: string
  source: string
  source_id: string | null
  deadline: string | null
  priority: string
  evidence: string | null
  confidence: number
}

const WIPE_SYNC = `
  delete from task_links; delete from tasks where source in ('gmail','gcalendar');
  delete from processed_messages; delete from sync_state;`

async function timedSync(qa: QaApp) {
  const started = Date.now()
  const report = (await qa.action('syncNow')) as SyncReport
  return { report, ms: Date.now() - started }
}

function aiCalls(qa: QaApp) {
  const file = join(qa.dataDir, 'ai-calls.jsonl')
  if (!existsSync(file)) return []
  return readFileSync(file, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as { purpose: string; engine: string; ms: number; ok: boolean })
}

const squash = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase()

test('M3a labelled corpus through the real pipeline', async () => {
  const run = activeRun()!
  const answers = join(run, 'm3-answers.json')
  const google = await startServer('fake-google', ['--corpus', 'eval/corpus/seed.jsonl', '--log', join(run, 'fake-google.jsonl'), '--answers', answers])
  const qa = await launchQa({
    mission: 'm3',
    profile: 'typical',
    variant: 'replay',
    config: { displayName: 'Sally Beck', aboutMe: '' },
    env: { AMBIENTMIND_QA_GOOGLE: google.url },
    prepare: (dataDir) => seed(dataDir, WIPE_SYNC)
  })
  try {
    const first = await timedSync(qa)
    const second = await timedSync(qa)
    const messages = JSON.parse(readFileSync(answers, 'utf8')) as (LabelledMessage & { gmailId: string })[]
    const rows = query<Row>(qa.dataDir, "select * from tasks where source in ('gmail','gcalendar')")
    const scored = messages.map((m) => {
      const predicted = rows
        .filter((r) => r.source === 'gmail' && r.source_id?.startsWith(m.gmailId))
        .map((r) => ({ title: r.title, deadline: r.deadline, priority: r.priority as 'medium', people: [], confidence: r.confidence, evidence: r.evidence ?? '' }))
      return scoreMessage(m, predicted as never, 0)
    })
    const metrics = aggregate(scored, messages)
    // Evidence must be a quote from the message it came from.
    const badEvidence = rows
      .filter((r) => r.source === 'gmail' && r.evidence)
      .filter((r) => {
        const m = messages.find((x) => r.source_id?.startsWith(x.gmailId))
        return !m || !squash(`${m.subject} ${m.body}`).includes(squash(r.evidence!).replace(/^"|"$/g, ''))
      })
      .map((r) => ({ title: r.title, evidence: r.evidence }))
    // A meeting that repeats a mail task should not become a second open task.
    const open = rows.filter((r) => r.status === 'pending' || r.status === 'suggested')
    const duplicates = open.flatMap((a, i) =>
      open.slice(i + 1).flatMap((b) => (a.source !== b.source && pair([{ title: a.title, deadline: null, priority: 'medium' }], [{ title: b.title } as never]).matched.length ? [[a.title, b.title]] : []))
    )
    const calls = aiCalls(qa)
    const result = {
      first,
      second,
      metrics,
      perMessage: scored.map((s) => ({ id: s.id, gold: s.gold.map((g) => g.title), predicted: s.predicted.map((p) => p.title), tp: s.truePositives, fp: s.falsePositives, fn: s.falseNegatives })),
      badEvidence,
      duplicates,
      engines: calls.reduce<Record<string, number>>((acc, c) => ({ ...acc, [`${c.purpose}:${c.engine}:${c.ok ? 'ok' : 'failed'}`]: (acc[`${c.purpose}:${c.engine}:${c.ok ? 'ok' : 'failed'}`] ?? 0) + 1 }), {}),
      calendarTasks: rows.filter((r) => r.source === 'gcalendar').map((r) => r.title)
    }
    writeFileSync(join(qa.out, 'result.json'), JSON.stringify(result, null, 2))
    if (first.report.errors.length) qa.candidate({ severity: 'S2', title: 'Errors in a sync of the labelled corpus', detail: first.report.errors })
    if (second.report.added > 0) qa.candidate({ severity: 'S2', title: `A second sync of the same mail added ${second.report.added} task(s)`, detail: second.report })
    if (badEvidence.length) qa.candidate({ severity: 'S3', title: `${badEvidence.length} task(s) quote evidence that isn't in the message`, detail: badEvidence })
    if (duplicates.length) qa.candidate({ severity: 'S3', title: 'The same commitment is open twice (mail and calendar)', detail: duplicates })
    expect(first.report.errors).toEqual([])
    expect(second.report.added).toBe(0)
  } finally {
    await qa.close()
    google.stop()
  }
})

test('M3b your real mail, read-only', async () => {
  const live = query<Row>(join(activeRun()!, 'profiles', 'snapshot'), "select * from tasks where source in ('gmail','gcalendar')")
  for (const variant of ['incremental', 'fresh'] as const) {
    const qa = await launchQa({
      mission: 'm3',
      profile: 'snapshot',
      variant,
      ...(variant === 'fresh'
        ? { prepare: (dataDir: string) => seed(dataDir, "delete from processed_messages; delete from sync_state; delete from tasks where source = 'gmail' and status in ('pending','suggested');") }
        : {})
    })
    try {
      const sync = await timedSync(qa)
      const attempts = await qa.attempts()
      const blocked = attempts.filter((a) => a.blocked && a.kind.startsWith('network'))
      const rows = query<Row>(qa.dataDir, "select * from tasks where source in ('gmail','gcalendar') and status in ('pending','suggested')")
      const extractLines = qa.mainLog.filter((l) => l.startsWith('[sync] extract'))
      const result = {
        sync,
        blocked: blocked.map((a) => a.detail),
        open: rows.map((r) => ({ title: r.title, status: r.status, source: r.source, deadline: r.deadline, confidence: r.confidence, evidence: r.evidence })),
        // Against what your own app kept: the same message found again, or not.
        comparedToLive:
          variant === 'fresh'
            ? {
                liveOpen: live.filter((r) => r.source === 'gmail' && (r.status === 'pending' || r.status === 'suggested')).map((r) => r.title),
                foundAgain: rows.filter((r) => live.some((l) => l.source_id === r.source_id)).map((r) => r.title),
                newNow: rows.filter((r) => r.source === 'gmail' && !live.some((l) => l.source_id === r.source_id)).map((r) => r.title),
                youDeletedButFoundAgain: rows.filter((r) => live.some((l) => l.source_id === r.source_id && l.status === 'deleted')).map((r) => r.title)
              }
            : null,
        extractLines,
        engines: aiCalls(qa).map((c) => `${c.purpose}:${c.engine}:${c.ms}ms:${c.ok ? 'ok' : 'failed'}`)
      }
      writeFileSync(join(qa.out, 'result.json'), JSON.stringify(result, null, 2))
      const googleBlocked = blocked.filter((a) => String(a.detail.url).includes('google'))
      if (googleBlocked.length) qa.candidate({ severity: 'S1', title: 'The app tried a Google call that is not a read', detail: googleBlocked.map((a) => a.detail) })
      if (sync.report.errors.length) qa.candidate({ severity: 'S2', title: `Errors syncing your real mail (${variant})`, detail: sync.report.errors })
    } finally {
      await qa.close()
    }
  }
})
