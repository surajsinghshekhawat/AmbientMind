/**
 * Sync errors that are not faults (a pass already running) or that the health
 * check already explains in its own words (paused, not connected, no model,
 * missing scopes). Saying them twice would only push the real problem down.
 */
const ALREADY_SAID = [
  /already in progress/i,
  /^AI paused /,
  /not connected/i,
  /^No AI model is available/i,
  /without access to Gmail and Calendar/i
]

/** The last sync's error as a line for the panel, or null when there is nothing new to say. */
export function syncProblem(lastError: string | null | undefined): string | null {
  const error = lastError?.trim()
  if (!error || ALREADY_SAID.some((pattern) => pattern.test(error))) return null
  return `Last sync: ${error}`
}
