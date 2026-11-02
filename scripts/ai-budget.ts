import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { readCalls, summariseCalls } from '../electron/services/aiLog'

/**
 * How long each kind of model call takes, per engine, from the app's call log.
 *   ./dev npm run ai:budget [-- --since 2026-11-01 --file path/to/ai-calls.jsonl]
 */
const { values } = parseArgs({
  options: {
    file: { type: 'string' },
    since: { type: 'string' }
  }
})

const file = values.file ?? join(process.env.AMBIENTMIND_DATA_DIR ?? '.local/data', 'ai-calls.jsonl')
const since = values.since ? Date.parse(values.since) : Number.NEGATIVE_INFINITY
const calls = readCalls(file).filter((call) => Date.parse(call.at) >= since)

if (calls.length === 0) {
  console.log(`No model calls recorded in ${file}.`)
  process.exit(0)
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)}s`
const rows = summariseCalls(calls)
const header = ['purpose', 'engine', 'calls', 'failed', 'fell back', 'p50', 'p95', 'max', 'prompt chars']
const table = rows.map((row) => [
  row.purpose,
  row.engine,
  String(row.calls),
  String(row.failures),
  String(row.fallbacks),
  seconds(row.p50),
  seconds(row.p95),
  seconds(row.max),
  String(row.avgPromptChars)
])
const widths = header.map((title, i) => Math.max(title.length, ...table.map((row) => row[i]!.length)))
const line = (cells: string[]) => cells.map((cell, i) => cell.padEnd(widths[i]!)).join('  ')

console.log(`\n${calls.length} calls from ${calls[0]!.at.slice(0, 16)} to ${calls.at(-1)!.at.slice(0, 16)}\n`)
console.log(line(header))
console.log(line(widths.map((width) => '-'.repeat(width))))
for (const row of table) console.log(line(row))
console.log()
