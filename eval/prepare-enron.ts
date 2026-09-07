/**
 * Turns the raw Kaggle Enron dump into an unlabelled JSONL file ready for
 * annotation.
 *
 *   1. Download https://www.kaggle.com/datasets/wcukierski/enron-email-dataset
 *   2. Put emails.csv in eval/enron-raw/
 *   3. npm run eval:prepare -- --count 200
 *   4. Fill in goldTasks by hand, then rename to eval/corpus/enron-200.jsonl
 *
 * Sampling is stratified towards messages that plausibly contain a task, then
 * deliberately padded with obvious non-tasks, because a corpus drawn uniformly
 * from 500k emails is mostly forwarded chaff and would flatter the model's
 * precision without testing it.
 */
import { createReadStream, mkdirSync, writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { dirname, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import type { LabelledMessage } from './types'

const { values } = parseArgs({
  options: {
    input: { type: 'string', default: 'eval/enron-raw/emails.csv' },
    out: { type: 'string', default: 'eval/corpus/enron-unlabelled.jsonl' },
    count: { type: 'string', default: '200' },
    /** Share of the sample drawn from messages with no task-like signal. */
    negativeRatio: { type: 'string', default: '0.4' },
    seed: { type: 'string', default: '42' }
  }
})

const ACTION_HINT =
  /\b(can you|could you|please|need you to|by (eod|cob|friday|monday|tomorrow|next week)|let me know|send me|forward me|review|sign off|approve|i'?ll send|i will send|deadline|asap)\b/i

const BULK_HINT = /\b(unsubscribe|automated message|do not reply|no-reply|newsletter)\b/i

/** Minimal RFC-822 parse: the Kaggle dump stores whole raw messages. */
function parseRaw(raw: string) {
  const split = raw.indexOf('\n\n')
  const headerBlock = split === -1 ? raw : raw.slice(0, split)
  const body = split === -1 ? '' : raw.slice(split + 2)

  const header = (name: string) =>
    new RegExp(`^${name}:\\s*(.*)$`, 'im').exec(headerBlock)?.[1]?.trim() ?? ''

  return {
    sender: header('From'),
    recipients: header('To'),
    sentAt: header('Date'),
    subject: header('Subject'),
    body: body.trim()
  }
}

/** Deterministic PRNG so a given seed always yields the same sample. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

async function* records(path: string) {
  // The dump is a two-column CSV (file, message) with embedded newlines inside
  // quoted fields, so rows are reassembled by tracking quote parity.
  const reader = createInterface({ input: createReadStream(resolve(path), 'utf8') })
  let buffer = ''
  let quotes = 0
  let first = true

  for await (const line of reader) {
    if (first) {
      first = false
      continue
    }
    buffer += (buffer ? '\n' : '') + line
    quotes += (line.match(/"/g) ?? []).length
    if (quotes % 2 !== 0) continue

    const comma = buffer.indexOf(',')
    const message = buffer.slice(comma + 1).replace(/^"|"$/g, '').replace(/""/g, '"')
    yield message
    buffer = ''
    quotes = 0
  }
}

async function main() {
  const target = Number(values.count)
  const negativeTarget = Math.round(target * Number(values.negativeRatio))
  const positiveTarget = target - negativeTarget
  const random = mulberry32(Number(values.seed))

  const positives: LabelledMessage[] = []
  const negatives: LabelledMessage[] = []
  let seen = 0

  for await (const raw of records(values.input!)) {
    seen++
    const parsed = parseRaw(raw)
    if (parsed.body.length < 80 || parsed.body.length > 4000) continue
    if (!parsed.subject || parsed.subject.toLowerCase().startsWith('fw:')) continue

    const message: LabelledMessage = {
      id: `enron-${String(seen).padStart(6, '0')}`,
      ...parsed,
      goldTasks: [],
      notes: 'UNLABELLED'
    }

    const looksActionable = ACTION_HINT.test(parsed.body) && !BULK_HINT.test(parsed.body)
    const bucket = looksActionable ? positives : negatives
    const cap = looksActionable ? positiveTarget : negativeTarget

    // Reservoir sampling keeps the pass single and memory flat over 500k rows.
    if (bucket.length < cap) {
      bucket.push(message)
    } else {
      const index = Math.floor(random() * bucket.length)
      if (random() < 0.02) bucket[index] = message
    }

    if (positives.length >= positiveTarget && negatives.length >= negativeTarget && seen > 50_000) break
  }

  const sample = [...positives, ...negatives]
  mkdirSync(dirname(resolve(values.out!)), { recursive: true })
  writeFileSync(resolve(values.out!), sample.map((m) => JSON.stringify(m)).join('\n') + '\n')

  console.log(`Scanned ${seen} messages.`)
  console.log(`Wrote ${sample.length} to ${values.out} (${positives.length} action-like, ${negatives.length} control).`)
  console.log('Now fill in goldTasks for each record, then rename to eval/corpus/enron-200.jsonl.')
}

void main()
