/**
 * Decides whether a spoken (or typed) utterance means "look at my screen"
 * rather than "create a task from these words".
 *
 * Kept as a pure function so the same rules apply to voice and to typed
 * shortcuts, and so the rules can be unit-tested without Electron.
 *
 * The screen has to be named, and named as the thing being read: "fix the
 * screen door" or "finish this task" must stay ordinary tasks, because a false
 * capture takes a screenshot the user never asked for.
 */
const SCREEN = String.raw`(?:(?:my|the|this)\s+)?screen`

// "the screen" must end the phrase, so "screen door" and "screen time" don't count.
const END = String.raw`(?=\s*$|\s*[,.!?;:]|\s+(?:to|into|as|for|then|please|now)\b)`

/** A verb that acts on the screen itself: "capture my screen", "read the screen". */
const DIRECT = new RegExp(
  String.raw`\b(?:capture|read|see|scan|grab|check|look\s+at|turn|use)\s+${SCREEN}\b(?:${END}|\s+and\b)`,
  'i'
)

/** Something "on" or "from" the screen, which then needs an action word. */
const FROM_SCREEN = new RegExp(String.raw`\b(?:on|from|off|of)\s+${SCREEN}\b${END}`, 'i')
const ACTION = /\b(?:add|make|create|capture|file|save|grab|take|turn|put|what'?s|what\s+is)\b/i

export function isScreenCaptureIntent(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) return false
  if (DIRECT.test(trimmed)) return true
  return FROM_SCREEN.test(trimmed) && ACTION.test(trimmed)
}
