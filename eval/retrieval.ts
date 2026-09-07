import { embed } from '../electron/services/ollama'
import type { LabelledMessage } from './types'

/**
 * The production path retrieves through sqlite-vec. The harness uses brute-force
 * cosine over the same embeddings instead: at corpus scale the two return
 * identical neighbours, and this keeps the harness runnable under plain Node
 * without a native module built against Electron's ABI.
 */

export interface IndexedExample {
  id: string
  text: string
  /** Gold extraction, so the ablation measures retrieval rather than the model's own errors. */
  tasks: { title: string; deadline: string | null; priority: string }[]
  embedding: number[]
}

function cosine(a: number[], b: number[]): number {
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!
    const y = b[i]!
    dot += x * y
    na += x * x
    nb += y * y
  }
  return na === 0 || nb === 0 ? 0 : dot / Math.sqrt(na * nb)
}

/** The exact text embedded for a message, shared by indexing and querying. */
export function embeddingText(message: LabelledMessage): string {
  return `Subject: ${message.subject}\nFrom: ${message.sender}\n\n${message.body}`
}

export async function buildIndex(
  corpus: LabelledMessage[],
  model = 'nomic-embed-text',
  onProgress?: (done: number, total: number) => void
): Promise<IndexedExample[]> {
  const index: IndexedExample[] = []
  for (const [i, message] of corpus.entries()) {
    const text = embeddingText(message)
    index.push({ id: message.id, text, tasks: message.goldTasks, embedding: await embed(text, model) })
    onProgress?.(i + 1, corpus.length)
  }
  return index
}

/**
 * Leave-one-out: a message never retrieves itself, otherwise the ablation would
 * be measuring memorisation rather than generalisation.
 */
export function retrieve(
  index: IndexedExample[],
  queryEmbedding: number[],
  excludeId: string,
  k = 5
): IndexedExample[] {
  return index
    .filter((example) => example.id !== excludeId)
    .map((example) => ({ example, score: cosine(queryEmbedding, example.embedding) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map((entry) => entry.example)
}

const MAX_EXAMPLE_CHARS = 600

export function renderFewShot(examples: IndexedExample[]): string {
  if (examples.length === 0) return ''

  const blocks = examples.map((example) => {
    const body =
      example.text.length > MAX_EXAMPLE_CHARS
        ? `${example.text.slice(0, MAX_EXAMPLE_CHARS)}…`
        : example.text
    return `MESSAGE:\n${body}\n\nEXTRACTED:\n${JSON.stringify({ tasks: example.tasks })}`
  })

  return `--- EXAMPLES FROM THIS USER'S HISTORY ---\n${blocks.join(
    '\n\n---\n\n'
  )}\n--- END EXAMPLES ---`
}
