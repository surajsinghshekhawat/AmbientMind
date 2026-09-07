import { join } from 'node:path'
import { app, desktopCapturer, screen } from 'electron'
import { createWorker, type Worker } from 'tesseract.js'
import { resolveDeadline } from '@shared/deadline'
import { formatPromptTime } from '@shared/promptTime'
import type { TaskPriority } from '@shared/types'
import { SCREEN_TASK_SCHEMA, buildScreenTaskPrompt } from '../../prompts/screenTask'
import { chat } from './ollama'

/**
 * Reads the current screen and turns it into a task.
 *
 * OCR rather than a vision model, deliberately. A VLM that could read a
 * screenshot well (qwen2.5vl:3b and up) needs ~3.2GB of VRAM, which on a 4GB
 * card means evicting the extraction model on every capture and reloading it
 * afterwards. Screens are overwhelmingly text, so OCR gets the same signal for
 * ~15MB and no VRAM at all. The seam is `readScreenText`, so a VLM backend can
 * replace it later without touching the rest of the pipeline.
 */

export interface ScreenTask {
  title: string
  summary: string
  deadline: string | null
  priority: TaskPriority
  people: string[]
}

let worker: Worker | null = null

async function getWorker(): Promise<Worker> {
  // Loading the language data takes a few seconds, so the worker is kept warm
  // for the rest of the session after the first capture. The ~4MB model is
  // fetched once and cached under userData; without an explicit cachePath
  // tesseract.js writes it into the process working directory.
  worker ??= await createWorker('eng', undefined, {
    cachePath: join(app.getPath('userData'), 'tesseract')
  })
  return worker
}

export async function disposeScreenContext() {
  await worker?.terminate()
  worker = null
}

export interface Capture {
  png: Buffer
  windowTitle: string
}

/**
 * Captures the full primary display at native resolution. Downscaled
 * thumbnails are the default and are unreadable to OCR, so the size is pinned
 * to the display's actual pixel dimensions.
 */
export async function captureScreen(): Promise<Capture> {
  const display = screen.getPrimaryDisplay()
  const { width, height } = display.size
  const scale = display.scaleFactor || 1

  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: Math.round(width * scale), height: Math.round(height * scale) }
  })

  const source = sources[0]
  if (!source || source.thumbnail.isEmpty()) {
    throw new Error('Unable to capture the screen')
  }

  return { png: source.thumbnail.toPNG(), windowTitle: source.name }
}

/** Drops OCR lines that are too short or too garbled to carry meaning. */
function denoise(text: string): string {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => {
      if (line.length < 3) return false
      const letters = (line.match(/[a-zA-Z]/g) ?? []).length
      // Toolbars and icon rows OCR into punctuation soup; require real words.
      return letters / line.length > 0.5
    })

  return lines.join('\n').slice(0, 6000)
}

export async function readScreenText(png: Buffer): Promise<string> {
  const { data } = await (await getWorker()).recognize(png)
  return denoise(data.text)
}

export async function screenToTask(
  instruction: string,
  options: { model?: string; userName?: string } = {}
): Promise<ScreenTask | null> {
  const capture = await captureScreen()
  console.log(`[screen] captured "${capture.windowTitle}" (${capture.png.length} bytes)`)

  const screenText = await readScreenText(capture.png)
  console.log(`[screen] ocr produced ${screenText.length} chars`)

  if (screenText.length < 40) return null

  const { system, user } = buildScreenTaskPrompt({
    // Without a name the model cannot tell which of the people on screen is
    // the one being asked to do something, and it returns nothing.
    userName: options.userName?.trim() || 'the user',
    instruction: instruction.trim() || 'none given; use your judgement',
    currentTime: formatPromptTime(),
    windowTitle: capture.windowTitle,
    screenText
  })

  const raw = await chat({
    ...(options.model ? { model: options.model } : {}),
    system,
    user,
    format: SCREEN_TASK_SCHEMA,
    numPredict: 300
  })

  console.log('[screen] model returned:', raw.slice(0, 400))

  const parsed = JSON.parse(raw) as Partial<ScreenTask>
  const title = typeof parsed.title === 'string' ? parsed.title.trim() : ''
  if (!title) return null

  return {
    title,
    summary: typeof parsed.summary === 'string' ? parsed.summary.trim() : '',
    deadline: resolveDeadline(parsed.deadline),
    priority: (['low', 'medium', 'high', 'urgent'] as const).includes(
      parsed.priority as TaskPriority
    )
      ? (parsed.priority as TaskPriority)
      : 'medium',
    people: Array.isArray(parsed.people)
      ? parsed.people.filter((p): p is string => typeof p === 'string')
      : []
  }
}
