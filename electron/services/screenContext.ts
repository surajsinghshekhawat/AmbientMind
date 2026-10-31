import { join } from 'node:path'
import { app, desktopCapturer, screen } from 'electron'
import { createWorker, type Worker } from 'tesseract.js'
import { resolveDeadline } from '@shared/deadline'
import { HelperError } from '@shared/helperProtocol'
import { formatPromptTime } from '@shared/promptTime'
import {
  AX_ENOUGH_CHARS,
  EXCLUDED_BUNDLE_IDS,
  MIN_SCREEN_CHARS,
  denoiseOcr,
  focusedText,
  windowTitle,
  type ScreenReading
} from '@shared/screenRead'
import type { TaskPriority } from '@shared/types'
import { SCREEN_TASK_SCHEMA, buildScreenTaskPrompt } from '../../prompts/screenTask'
import { helperReady, helperRequest } from '../native/helper'
import { accessStatus, isMac } from '../platform'
import { chat } from './ollama'

/**
 * Reads the current screen and turns it into a task.
 *
 * On the Mac the Swift helper reads the window in front: its text through
 * Accessibility when the app exposes it (exact, and no pixels involved), or
 * that one window through ScreenCaptureKit and Vision OCR. Everywhere else,
 * and whenever the helper cannot, the whole display under the cursor is
 * captured and OCR'd.
 *
 * OCR rather than a vision model, deliberately. A VLM that could read a
 * screenshot well (qwen2.5vl:3b and up) needs ~3.2GB of VRAM, which on a 4GB
 * card means evicting the extraction model on every capture and reloading it
 * afterwards. Screens are overwhelmingly text, so OCR gets the same signal for
 * ~15MB and no VRAM at all.
 */

export interface ScreenTask {
  title: string
  summary: string
  deadline: string | null
  priority: TaskPriority
  people: string[]
}

/** The window in front belongs to an app that is never read. */
export class ScreenRefused extends Error {
  constructor(readonly appName: string) {
    super(`AmbientMind doesn’t read ${appName}.`)
    this.name = 'ScreenRefused'
  }
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
 * Captures the display the cursor is on, at native resolution. Downscaled
 * thumbnails are the default and are unreadable to OCR, so the size is pinned
 * to the display's actual pixel dimensions.
 *
 * The cursor rather than the primary display: on a two-monitor desk the thing
 * worth capturing is the one being worked on, and capturing the wrong screen
 * fails silently — you get a task about whatever was idle on monitor one.
 */
export async function captureScreen(): Promise<Capture> {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const { width, height } = display.size
  const scale = display.scaleFactor || 1

  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: Math.round(width * scale), height: Math.round(height * scale) }
  })

  // display_id is a string on every platform; Display#id is a number.
  const source =
    sources.find((candidate) => candidate.display_id === String(display.id)) ?? sources[0]
  if (!source || source.thumbnail.isEmpty()) {
    throw new Error('Unable to capture the screen')
  }

  return { png: source.thumbnail.toPNG(), windowTitle: source.name }
}

/** Vision through the helper when it is there; Tesseract otherwise. */
export async function readScreenText(png: Buffer): Promise<string> {
  if (helperReady()) {
    try {
      const { text } = await helperRequest('ocr.image', { png: png.toString('base64') }, { timeoutMs: 20_000 })
      return denoiseOcr(text)
    } catch (err) {
      console.warn('[screen] helper OCR failed; using tesseract:', (err as Error).message)
    }
  }
  const { data } = await (await getWorker()).recognize(png)
  return denoiseOcr(data.text)
}

/** Accessibility, then that window's pixels, then the whole display. */
export async function readScreen(): Promise<ScreenReading> {
  let fallbackTitle = ''
  let axText = ''
  if (isMac && helperReady()) {
    try {
      const context = await helperRequest('context.focused', { excludeBundleIds: EXCLUDED_BUNDLE_IDS, maxChars: 12_000 })
      if (context.excluded) throw new ScreenRefused(context.app ?? 'this app')
      fallbackTitle = windowTitle(context)
      axText = focusedText(context)
      console.log(`[screen] ${context.app}: ${axText.length} chars through accessibility`)
      if (axText.length >= AX_ENOUGH_CHARS) return { text: axText, windowTitle: fallbackTitle, source: 'accessibility' }

      if (context.windowId && accessStatus('screen') === 'granted') {
        const ocr = await helperRequest('capture.windowOCR', { windowId: context.windowId }, { timeoutMs: 20_000 })
        const text = denoiseOcr(ocr.text)
        console.log(`[screen] window OCR produced ${text.length} chars`)
        if (text.length >= MIN_SCREEN_CHARS) return { text, windowTitle: fallbackTitle, source: 'window-ocr' }
      }
      // Some text beats a Screen Recording prompt the user cannot act on.
      if (axText.length >= MIN_SCREEN_CHARS && accessStatus('screen') !== 'granted') {
        return { text: axText, windowTitle: fallbackTitle, source: 'accessibility' }
      }
    } catch (err) {
      if (err instanceof ScreenRefused) throw err
      if (!(err instanceof HelperError)) throw err
      console.warn('[screen] helper could not read the window:', err.message)
    }
  }

  const capture = await captureScreen()
  console.log(`[screen] captured "${capture.windowTitle}" (${capture.png.length} bytes)`)
  const text = await readScreenText(capture.png)
  console.log(`[screen] display OCR produced ${text.length} chars`)
  if (text.length < MIN_SCREEN_CHARS && axText.length > text.length) {
    return { text: axText, windowTitle: fallbackTitle, source: 'accessibility' }
  }
  return { text, windowTitle: fallbackTitle || capture.windowTitle, source: 'display-ocr' }
}

export async function screenToTask(
  instruction: string,
  options: { model?: string; userName?: string; aboutMe?: string } = {}
): Promise<ScreenTask | null> {
  const reading = await readScreen()
  if (reading.text.length < MIN_SCREEN_CHARS) return null

  const { system, user } = buildScreenTaskPrompt({
    // Without a name the model cannot tell which of the people on screen is
    // the one being asked to do something, and it returns nothing.
    userName: options.userName?.trim() || 'the user',
    ...(options.aboutMe ? { aboutMe: options.aboutMe } : {}),
    instruction: instruction.trim() || 'none given; use your judgement',
    currentTime: formatPromptTime(),
    windowTitle: reading.windowTitle || 'unknown',
    screenText: reading.text,
    source: reading.source === 'accessibility' ? 'accessibility' : 'ocr'
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
