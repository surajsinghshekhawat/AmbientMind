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
  /** How far back to read. Sync uses 2 days; a corpus needs a real sample. */
  days?: number
  onProgress?: (done: number, total: number) => void
}

export interface CorpusExportResult {
  path: string
  /** Messages the pre-filter rejected, written out separately for auditing. */
  filteredPath: string
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

  const ids = await listRecentMessageIds(`newer_than:${options.days ?? 30}d -in:chats`)
  const lines: string[] = []
  const filtered: string[] = []
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

    // Pre-filtered mail is kept out of the scored corpus — the filter runs
    // before the model, so scoring it would measure the filter, not the
    // extractor. It is still written to a separate file, because a filter
    // quietly eating real mail is invisible otherwise, and that is a worse
    // failure than a missed extraction.
    const skipReason = shouldSkip(fetched.message, fetched.payload)
    if (skipReason) {
      skipped++
      filtered.push(
        JSON.stringify({
          id,
          sender: fetched.message.sender,
          sentAt: fetched.message.sentAt,
          subject: fetched.message.subject,
          skipReason,
          bodyPreview: fetched.message.body.slice(0, 400)
        })
      )
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

  const stamp = Date.now()
  const path = join(app.getPath('userData'), `corpus-${stamp}.jsonl`)
  const filteredPath = join(app.getPath('userData'), `corpus-${stamp}-filtered.jsonl`)
  writeFileSync(path, `${lines.join('\n')}\n`, 'utf8')
  writeFileSync(filteredPath, `${filtered.join('\n')}\n`, 'utf8')

  return { path, filteredPath, messages: lines.length, prefilledTasks, skipped }
}
