import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { fetchMessage, listRecentMessageIds, shouldSkip } from './integrations/gmail'
import { connectedGoogleAccount } from './googleAuth'
import { extractTasks } from './ollama'

/**
 * The extraction numbers in docs/SYSTEM.md come from Enron mail, which is not
 * this user's mail. Real accuracy can only be measured on messages the user
 * can actually judge.
 *
 * Labelling from scratch is tedious enough that it does not happen, so the
 * export pre-fills each message with what the model currently extracts. The
 * job then becomes correcting a draft: delete the wrong ones, fix a deadline,
 * add what was missed. An empty goldTasks array is a real label, not a gap.
 */
export interface CorpusExportOptions {
  model?: string
  userName?: string
  aboutMe?: string
  limit?: number
  onProgress?: (done: number, total: number) => void
}

export interface CorpusExportResult {
  path: string
  messages: number
  prefilledTasks: number
  skipped: number
}

export async function exportCorpus(
  options: CorpusExportOptions = {}
): Promise<CorpusExportResult> {
  const userEmail = connectedGoogleAccount() ?? 'me'
  const userName = options.userName ?? userEmail.split('@')[0] ?? 'the user'
  const limit = options.limit ?? 40

  const ids = await listRecentMessageIds()
  const lines: string[] = []
  let prefilledTasks = 0
  let skipped = 0

  for (const [index, { id }] of ids.slice(0, limit).entries()) {
    options.onProgress?.(index + 1, Math.min(ids.length, limit))

    let fetched
    try {
      fetched = await fetchMessage(id)
    } catch {
      continue
    }

    // Pre-filtered mail is excluded on purpose: the filter runs before the
    // model, so scoring it would measure the filter, not the extractor.
    if (shouldSkip(fetched.message, fetched.payload)) {
      skipped++
      continue
    }

    const extracted = await extractTasks(fetched.message, {
      ...(options.model ? { model: options.model } : {}),
      userName,
      userEmail,
      ...(options.aboutMe ? { aboutMe: options.aboutMe } : {})
    })
    prefilledTasks += extracted.length

    lines.push(
      JSON.stringify({
        id,
        sender: fetched.message.sender,
        recipients: fetched.message.recipients,
        sentAt: fetched.message.sentAt,
        subject: fetched.message.subject,
        body: fetched.message.body,
        goldTasks: extracted.map((task) => ({
          title: task.title,
          deadline: task.deadline,
          priority: task.priority
        })),
        notes: 'PREFILLED BY THE MODEL — correct this before scoring.'
      })
    )
  }

  const path = join(app.getPath('userData'), `corpus-${Date.now()}.jsonl`)
  writeFileSync(path, `${lines.join('\n')}\n`, 'utf8')

  return { path, messages: lines.length, prefilledTasks, skipped }
}
