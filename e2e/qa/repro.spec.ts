import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from '@playwright/test'
import { activeRun, appendJsonl, launchQa, type QaApp } from './harness'

/**
 * M9: targeted reproductions of what the other missions turned up
 * (docs/AGENT_QA.md). Each case runs several times on a fresh copy of the
 * snapshot profile and records whether the app survived.
 */

test.skip(!activeRun(), 'needs an active QA run')
test.setTimeout(30 * 60_000)

const REPEATS = Number(process.env.QA_REPRO_N ?? 5)

function crashLine(qa: QaApp) {
  const log = readFileSync(join(qa.out, 'main.log'), 'utf8')
  return log.split('\n').find((l) => l.startsWith('[harness] app exited')) ?? null
}

async function survived(qa: QaApp, ms = 3000) {
  const deadline = Date.now() + ms
  while (Date.now() < deadline && !qa.exited()) await new Promise((r) => setTimeout(r, 100))
  return !qa.exited()
}

/** Clear conversation reloads the chat window; the explorer then pressed Escape and reopened chat. */
const chatCases: Record<string, (qa: QaApp) => Promise<void>> = {
  'clear, then reopen at once': async (qa) => {
    const page = await qa.window('chat')
    await page.getByRole('button', { name: 'Clear conversation' }).click()
    await page.keyboard.press('Escape').catch(() => {})
    await qa.action('chat')
  },
  'clear, then reopen after 5 s': async (qa) => {
    const page = await qa.window('chat')
    await page.getByRole('button', { name: 'Clear conversation' }).click()
    await new Promise((r) => setTimeout(r, 5000))
    await page.keyboard.press('Escape').catch(() => {})
    await qa.action('chat')
  },
  'clear, nothing else': async (qa) => {
    const page = await qa.window('chat')
    await page.getByRole('button', { name: 'Clear conversation' }).click()
  },
  'reopen chat while it loads': async (qa) => {
    await qa.action('chat')
    await qa.action('chat')
  },
  'close, then reopen at once (no clear)': async (qa) => {
    const page = await qa.window('chat')
    await page.keyboard.press('Escape').catch(() => {})
    await qa.action('chat')
  },
  "clear, close, reopen through the panel's Ask (IPC, no inspector)": async (qa) => {
    const page = await qa.window('chat')
    const overlay = await qa.window('overlay')
    await page.getByRole('button', { name: 'Clear conversation' }).click()
    await page.keyboard.press('Escape').catch(() => {})
    await overlay.evaluate(() => (window as unknown as { ambient: { openChat: () => void } }).ambient.openChat())
  },
  "clear, then chat closes itself as the panel's Ask reopens it (IPC, no inspector)": async (qa) => {
    const page = await qa.window('chat')
    const overlay = await qa.window('overlay')
    await page.getByRole('button', { name: 'Clear conversation' }).click()
    await Promise.all([
      page.evaluate(() => (window as unknown as { ambient: { closeChat: () => void } }).ambient.closeChat()).catch(() => {}),
      overlay.evaluate(() => (window as unknown as { ambient: { openChat: () => void } }).ambient.openChat())
    ])
  }
}

const only = process.env.QA_REPRO_CASES?.split('|')

test('M9 chat clear and reopen', async () => {
  const out = join(activeRun()!, 'repro.jsonl')
  for (const [name, steps] of Object.entries(chatCases)) {
    if (only && !only.some((o) => name.startsWith(o))) continue
    for (let i = 0; i < REPEATS; i++) {
      const qa = await launchQa({ mission: 'm9', profile: 'snapshot', variant: `chat-${name.replace(/\W+/g, '-')}-${i}` })
      let error: string | null = null
      try {
        await qa.action('chat')
        await qa.window('chat')
        await steps(qa)
      } catch (err) {
        error = (err as Error).message.split('\n')[0]!
      }
      const alive = await survived(qa)
      appendJsonl(out, { case: `chat: ${name}`, i, alive, error, exit: alive ? null : crashLine(qa) })
      await qa.close()
    }
  }
})

const voiceCases: Record<string, number> = { 'press twice, 500 ms apart': 500, 'press twice, no gap': 0, 'record 4 s of tone': 4000 }

test('M9 quick capture voice', async () => {
  test.skip(!!only && !only.includes('voice'), 'QA_REPRO_CASES picks other cases')
  const out = join(activeRun()!, 'repro.jsonl')
  for (const mic of ['fake', 'refused'] as const) {
    for (const [name, gap] of Object.entries(voiceCases)) {
      for (let i = 0; i < REPEATS; i++) {
        const qa = await launchQa({
          mission: 'm9',
          profile: 'snapshot',
          variant: `voice-${mic}-${gap}-${i}`,
          env: mic === 'fake' ? { AMBIENTMIND_QA_FAKE_MIC: '1' } : {}
        })
        let error: string | null = null
        let message: string | null = null
        let transcript: string | null = null
        try {
          await qa.action('quickAdd')
          const page = await qa.window('quickadd')
          const talk = page.getByRole('button', { name: /^(Talk|Stop listening)/ })
          await talk.click()
          await new Promise((r) => setTimeout(r, gap))
          await talk.click({ timeout: 3000 }).catch(() => {})
          await new Promise((r) => setTimeout(r, 4000))
          message = (await page.locator('body').innerText()).replace(/\s+/g, ' ').trim().slice(0, 160)
          transcript = await page.getByRole('textbox', { name: 'What needs doing?' }).inputValue()
        } catch (err) {
          error = (err as Error).message.split('\n')[0]!
        }
        const alive = await survived(qa)
        const attempts = alive ? (await qa.attempts()).filter((a) => a.kind.startsWith('permission')).map((a) => `${a.kind}${a.blocked ? '' : ' (fake)'}`) : []
        appendJsonl(out, { case: `voice (${mic} mic): ${name}`, i, alive, error, message, transcript, attempts, exit: alive ? null : crashLine(qa) })
        await qa.close()
      }
    }
  }
})
