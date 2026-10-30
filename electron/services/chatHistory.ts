import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import type { ChatTurn } from '@shared/types'

const MAX_TURNS = 40

function filePath() {
  return join(app.getPath('userData'), 'chat-history.json')
}

function sanitise(raw: unknown): ChatTurn[] {
  if (!Array.isArray(raw)) return []
  const turns: ChatTurn[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const role = (entry as ChatTurn).role
    const content = (entry as ChatTurn).content
    if ((role !== 'user' && role !== 'assistant') || typeof content !== 'string') continue
    const trimmed = content.trim()
    if (!trimmed) continue
    turns.push({ role, content: trimmed.slice(0, 4000) })
  }
  return turns.slice(-MAX_TURNS)
}

export function loadChatHistory(): ChatTurn[] {
  try {
    return sanitise(JSON.parse(readFileSync(filePath(), 'utf8')))
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn('[chat] history unreadable:', (err as Error).message)
    }
    return []
  }
}

export function saveChatHistory(turns: ChatTurn[]): ChatTurn[] {
  const next = sanitise(turns)
  writeFileSync(filePath(), JSON.stringify(next, null, 2), 'utf8')
  return next
}
