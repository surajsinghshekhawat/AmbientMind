import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { embed, extractTasks, isAvailable, type ExtractedTask } from '../electron/services/ollama'
import { aggregate, scoreMessage, type ScoredMessage } from './score'
import { buildIndex, embeddingText, renderFewShot, retrieve, type IndexedExample } from './retrieval'
import type { LabelledMessage, Metrics } from './types'

const { values } = parseArgs({
  options: {
    corpus: { type: 'string', default: 'eval/corpus/seed.jsonl' },
    model: { type: 'string', default: 'qwen2.5:3b' },
    limit: { type: 'string' },
    /** Ablation switch: retrieves leave-one-out few-shot examples from the corpus. */
    rag: { type: 'boolean', default: false },
    k: { type: 'string', default: '5' },
    embedModel: { type: 'string', default: 'nomic-embed-text' },
    // Who the corpus belongs to. Without this the model cannot tell which
    // messages are addressed to the user, nor recognise the user's own
    // commitments, and recall collapses.
    userName: { type: 'string', default: 'Sally Beck' },
    userEmail: { type: 'string', default: 'sally.beck@enron.com' },
    minConfidence: { type: 'string', default: '0.6' },
    out: { type: 'string' },
    verbose: { type: 'boolean', default: false }
  }
})

function loadCorpus(path: string): LabelledMessage[] {
  return readFileSync(resolve(path), 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('//'))
    .map((line) => JSON.parse(line) as LabelledMessage)
}

const pct = (value: number) => `${(value * 100).toFixed(1)}%`

function report(metrics: Metrics, scored: ScoredMessage[], model: string, rag: boolean) {
  const latencies = scored.map((s) => s.latencyMs).sort((a, b) => a - b)
  const median = latencies[Math.floor(latencies.length / 2)] ?? 0

  console.log(`\n  model            ${model}${rag ? '  (RAG few-shot on)' : '  (zero-shot)'}`)
  console.log(`  messages         ${metrics.messagesScored}`)
  console.log(`  TP / FP / FN     ${metrics.truePositives} / ${metrics.falsePositives} / ${metrics.falseNegatives}`)
  console.log(`  precision        ${pct(metrics.precision)}`)
  console.log(`  recall           ${pct(metrics.recall)}`)
  console.log(`  F1               ${pct(metrics.f1)}`)
  console.log(`  empty-specificity${'  '}${pct(metrics.emptySpecificity)}   (task-free messages left alone)`)
  console.log(`  deadline accuracy ${pct(metrics.deadlineAccuracy)}  (matched pairs, same calendar day)`)
  console.log(`  median latency   ${(median / 1000).toFixed(1)}s per message\n`)
}

async function main() {
  if (!(await isAvailable())) {
    console.error('Ollama is not running. Start it with `ollama serve`, then retry.')
    process.exit(1)
  }

  const corpus = loadCorpus(values.corpus!)
  const limit = values.limit ? Number(values.limit) : corpus.length
  const messages = corpus.slice(0, limit)

  console.log(`Scoring ${messages.length} message(s) from ${values.corpus} with ${values.model}...`)

  let index: IndexedExample[] = []
  if (values.rag) {
    process.stdout.write('Embedding corpus for retrieval... ')
    index = await buildIndex(messages, values.embedModel!, (done, total) =>
      process.stdout.write(`\rEmbedding corpus for retrieval... ${done}/${total}`)
    )
    console.log(` done (${index[0]?.embedding.length ?? 0}-dim)`)
  }

  const scored: ScoredMessage[] = []
  for (const [position, message] of messages.entries()) {
    let fewShotExamples: string | undefined
    if (values.rag) {
      const queryEmbedding = await embed(embeddingText(message), values.embedModel!)
      fewShotExamples = renderFewShot(retrieve(index, queryEmbedding, message.id, Number(values.k)))
    }

    const started = performance.now()
    let predicted: ExtractedTask[] = []
    try {
      predicted = await extractTasks(message, {
        model: values.model!,
        userName: values.userName!,
        userEmail: values.userEmail!,
        minConfidence: Number(values.minConfidence),
        ...(fewShotExamples ? { fewShotExamples } : {})
      })
    } catch (err) {
      console.error(`  ${message.id}: extraction failed — ${(err as Error).message}`)
    }
    const latency = performance.now() - started
    scored.push(scoreMessage(message, predicted, latency))

    process.stdout.write(`\r  ${position + 1}/${messages.length}`)

    if (values.verbose) {
      console.log(`\n  [${message.id}] ${message.subject}`)
      console.log(`    gold:      ${message.goldTasks.map((t) => t.title).join(' | ') || '(none)'}`)
      console.log(`    predicted: ${predicted.map((t) => t.title).join(' | ') || '(none)'}`)
    }
  }
  process.stdout.write('\r')

  const metrics = aggregate(scored, messages)
  report(metrics, scored, values.model!, values.rag!)

  const outPath =
    values.out ?? `eval/results/${values.model!.replace(/[:/]/g, '-')}${values.rag ? '-rag' : ''}.json`
  mkdirSync(dirname(resolve(outPath)), { recursive: true })
  writeFileSync(
    resolve(outPath),
    JSON.stringify(
      { ranAt: new Date().toISOString(), model: values.model, rag: values.rag, corpus: values.corpus, metrics, scored },
      null,
      2
    )
  )
  console.log(`  written to ${outPath}`)
}

void main()
