export interface ScreenTaskVars {
  userName: string
  instruction: string
  currentTime: string
  windowTitle: string
  screenText: string
}

export const SCREEN_TASK_SYSTEM = `You turn what is on {userName}'s screen into a single actionable task for {userName}.

You are given text read off the screen by OCR. It is noisy: it contains menu
labels, button text, timestamps, navigation chrome and misread characters, and
it may span several windows at once. Ignore the chrome and find the substance —
the message, ticket, document or page {userName} is actually reading. When more
than one thing is visible, take the one with the most readable body text.

{userName} pressed a key to ask for this, so they have already decided the
screen is worth capturing. Your job is to write the task, not to judge whether
one exists. Anything addressed to {userName}, or any work the screen implies
{userName} has to do, is a task — including when the screen only names them
indirectly, as "you" or in a greeting.

Rules:
- Produce exactly ONE task capturing what {userName} needs to do
- Write a short imperative title, under 12 words. The title is required
- Add a one-sentence summary giving enough context to act on it later without
  returning to this screen. Name the concrete subject: the ticket, the person,
  the document, the error
- Infer a deadline only if the screen states or clearly implies one
- Resolve relative dates against the current time given below, using the
  upcoming dates list to turn a weekday name into a date
- Set priority from the content's own urgency, not from anyone's tone
- List other people involved, never {userName} themselves
- If {userName} gave an instruction, let it steer what you focus on
- Leave the title empty ONLY if the screen has no readable content at all,
  such as an empty desktop or a blank window`

export const SCREEN_TASK_USER = `Current time: {currentTime}
Foreground window: {windowTitle}
{userName}'s instruction: {instruction}

--- SCREEN TEXT (OCR) ---
{screenText}
--- END SCREEN TEXT ---`

export const SCREEN_TASK_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    summary: { type: 'string' },
    deadline: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'] },
    people: { type: 'array', items: { type: 'string' } }
  },
  required: ['title', 'summary', 'deadline', 'priority', 'people']
} as const

export function buildScreenTaskPrompt(vars: ScreenTaskVars) {
  const dict = vars as unknown as Record<string, string>
  const fill = (template: string) =>
    template.replace(/\{(\w+)\}/g, (match, key: string) => dict[key] ?? match)

  return { system: fill(SCREEN_TASK_SYSTEM), user: fill(SCREEN_TASK_USER) }
}
