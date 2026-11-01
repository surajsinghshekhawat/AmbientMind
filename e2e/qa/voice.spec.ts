import { spawnSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { activeRun, appendJsonl, launchQa, query, until } from './harness'

/**
 * M10: spoken capture end to end on the Whisper path. Speech made with `say`
 * plays through Chromium's fake microphone; nothing real is opened.
 */

const run = activeRun()
test.skip(!run, 'No active QA run')
test.describe.configure({ timeout: 5 * 60_000 })

const phrases = [
  { name: 'dentist', text: 'Call the dentist tomorrow at 10 am', words: ['dentist'], deadline: true },
  { name: 'report', text: 'Send the quarterly report to Priya by Friday', words: ['report', 'priya'], deadline: true },
  { name: 'milk', text: 'Buy milk', words: ['milk'], deadline: false }
]

function speak(text: string, file: string) {
  const aiff = file.replace(/\.wav$/, '.aiff')
  // A person draws breath after pressing Talk; the clip does too.
  const said = spawnSync('/usr/bin/say', ['-o', aiff, `[[slnc 700]] ${text}`], { encoding: 'utf8' })
  if (said.status !== 0) throw new Error(`say: ${said.stderr}`)
  const converted = spawnSync('/usr/bin/afconvert', ['-f', 'WAVE', '-d', 'LEI16@48000', '-c', '1', aiff, file], { encoding: 'utf8' })
  if (converted.status !== 0) throw new Error(`afconvert: ${converted.stderr}`)
}

for (const phrase of phrases) {
  test(`M10 voice: "${phrase.text}"`, async () => {
    const dir = join(run!, 'voice')
    mkdirSync(dir, { recursive: true })
    const wav = join(dir, `${phrase.name}.wav`)
    speak(phrase.text, wav)

    const qa = await launchQa({
      mission: 'm10',
      profile: 'snapshot',
      variant: phrase.name,
      config: { whisperModel: 'Xenova/whisper-base.en' },
      env: { AMBIENTMIND_QA_FAKE_MIC: '1', AMBIENTMIND_QA_FAKE_MIC_FILE: wav }
    })
    try {
      await qa.action('quickAdd')
      const page = await qa.window('quickadd')
      const box = page.getByRole('textbox', { name: 'What needs doing?' })
      const started = Date.now()
      await page.getByRole('button', { name: /^Talk/ }).click()
      // The clip is about two seconds; then silence, as the file doesn't loop.
      // A short one may already have stopped on the silence; pressing again would start over.
      await new Promise((r) => setTimeout(r, 3500))
      const stop = page.getByRole('button', { name: /^Stop listening/ })
      if (await stop.isVisible()) await stop.click()
      const transcript = (await until(async () => (await box.inputValue()).trim(), 90_000, 500)) || ''
      const ms = Date.now() - started
      const heard = phrase.words.every((w) => transcript.toLowerCase().includes(w))

      if (transcript) await box.press('Enter')
      const task = await until(
        () =>
          query<{ title: string; deadline: string | null; source: string }>(
            qa.dataDir,
            `select title, deadline, source from tasks where created_at >= '${new Date(started).toISOString()}' order by created_at desc limit 1`
          )[0],
        30_000
      )
      appendJsonl(join(run!, 'voice.jsonl'), { phrase: phrase.text, transcript, heard, ms, task: task ?? null })
      expect(transcript, 'Whisper heard something').not.toBe('')
      expect.soft(heard, `heard ${phrase.words.join(', ')} in "${transcript}"`).toBe(true)
      expect.soft(task, 'a task was made').toBeTruthy()
      if (phrase.deadline) expect.soft(task?.deadline, `a deadline from "${transcript}"`).toBeTruthy()
    } finally {
      await qa.close()
    }
  })
}
