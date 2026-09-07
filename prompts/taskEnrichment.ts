export interface EnrichmentVars {
  input: string
  currentTime: string
}

export const TASK_ENRICHMENT_SYSTEM = `You normalise a single task that a user typed into a quick-add box.

Rewrite the text as a short imperative task and pull out any timing the user implied.

Rules:
- Keep the user's own wording; fix only casing and obvious typos
- Strip the time expression out of the title ("call Sam tomorrow at 5" -> "Call Sam")
- Resolve relative times against the current time given below
- "morning" is 09:00, "afternoon" is 14:00, "evening" is 19:00, "tonight" is 20:00
- "EOD" and "end of day" are 17:00 today; "end of week" is Friday 17:00
- Emit the deadline as ISO-8601 local time, or null if the user implied no time
- Set priority to urgent only if the user said urgent, ASAP, or now
- Never invent a deadline that the user did not imply`

export const TASK_ENRICHMENT_USER = `Current time: {currentTime}
User typed: "{input}"`

export const ENRICHMENT_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    deadline: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'] },
    people: { type: 'array', items: { type: 'string' } }
  },
  required: ['title', 'deadline', 'priority', 'people']
} as const

export function buildEnrichmentPrompt(vars: EnrichmentVars) {
  return {
    system: TASK_ENRICHMENT_SYSTEM,
    user: TASK_ENRICHMENT_USER.replace('{currentTime}', vars.currentTime).replace(
      '{input}',
      vars.input
    )
  }
}
