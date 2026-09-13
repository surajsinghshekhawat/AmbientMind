/**
 * Prompts live as TypeScript modules rather than loose .txt files so the same
 * source works under the Electron bundler and under plain Node in the eval
 * harness, with no runtime file resolution or packaging step.
 */

export interface ExtractionVars {
  userName: string
  userEmail: string
  /** Optional free text about the user. Empty string when not configured. */
  aboutMe?: string
  fewShotExamples: string
  sender: string
  recipients: string
  sentAt: string
  subject: string
  body: string
}

export const TASK_EXTRACTION_SYSTEM = `You are a task extraction engine embedded in a desktop productivity app.
You read one message (an email, calendar event, or chat message) sent to {userName} <{userEmail}> and extract ONLY the genuine actionable tasks that {userName} personally needs to do.
{aboutBlock}
EXTRACT a task when:
- The message asks, assigns, or commits {userName} to a specific action
- The sender states a need or expectation rather than asking outright.
  "I need your sign-off", "need your plan by Friday", "waiting on your numbers"
  and "trading is blocked until you clear it" are all requests. Convert the noun
  into an action: "I need your sign-off on X" becomes "Sign off on X".
- The message was sent BY {userName} and contains a promise {userName} made.
  In that case extract only {userName}'s own commitments, never the recipient's.
  "I'll review the redline and get you comments by Friday" becomes
  "Review redline and send comments".
- A meeting or deadline requires preparation by {userName}

DO NOT extract:
- Newsletters, marketing, automated notifications, receipts, or system alerts
- FYI or status updates that require no response
- Work that someone other than {userName} is doing
- Vague intentions with no concrete action ("we should catch up sometime")
- Anything the message describes as already completed

Each task must:
- Start with a concrete action verb (send, review, call, prepare, submit, book, reply)
- Be under 12 words, phrased the way {userName} would write it
- Name the person involved when the action is directed at someone

DEADLINES:
- Resolve relative language against the message date, never against today
- "EOD" is 17:00, "morning" is 09:00, "end of week" is Friday 17:00
- "ASAP" and "urgent" raise priority; they are not deadlines
- Emit ISO-8601 local time, or null when no deadline is stated or implied

CONFIDENCE:
- 0.9+ for an explicit direct request, or an explicit commitment by {userName}
- 0.7 to 0.9 when clearly implied but requiring mild inference
- Below 0.6 is speculative: omit the task entirely

Return an empty array when the message contains no actionable task.`

export const TASK_EXTRACTION_USER = `{fewShotExamples}--- MESSAGE ---
From: {sender}
To: {recipients}
Date: {sentAt}
Subject: {subject}

{body}
--- END MESSAGE ---`

function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => vars[key] ?? match)
}

/**
 * Placed in the system prompt, next to the identity that measurably improved
 * extraction — not in the message block, where added context was measured to
 * crowd out the body and cost recall.
 */
export function buildAboutBlock(userName: string, aboutMe?: string): string {
  const text = aboutMe?.trim()
  if (!text) return ''
  return `
ABOUT ${userName} (background only; never turn this into a task):
${text}
`
}

export function buildExtractionPrompt(vars: ExtractionVars) {
  const dict = {
    ...(vars as unknown as Record<string, string>),
    aboutBlock: buildAboutBlock(vars.userName, vars.aboutMe)
  }
  return {
    system: fill(TASK_EXTRACTION_SYSTEM, dict),
    user: fill(TASK_EXTRACTION_USER, dict)
  }
}

/**
 * Constrains decoding so the model cannot emit prose or malformed JSON. Passed
 * to Ollama's `format` parameter, which compiles it to a GBNF grammar.
 */
export const EXTRACTION_SCHEMA = {
  type: 'object',
  properties: {
    tasks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          deadline: { anyOf: [{ type: 'string' }, { type: 'null' }] },
          priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'] },
          people: { type: 'array', items: { type: 'string' } },
          confidence: { type: 'number' }
        },
        required: ['title', 'deadline', 'priority', 'people', 'confidence']
      }
    }
  },
  required: ['tasks']
} as const
