export interface ChatVars {
  userName: string
  aboutBlock: string
  currentTime: string
  taskDigest: string
  doneDigest: string
  ruleDigest: string
  /** What the user already settled about things mentioned in this message. */
  decisionDigest: string
}

export const CHAT_KINDS = ['question', 'change', 'other'] as const
export const CHAT_ACTIONS = ['add', 'update', 'done', 'reopen', 'snooze', 'delete', 'repeat'] as const

/**
 * One call per message: what kind of message it is, the changes to make, then
 * the reply. Tasks are named by copying their title and times by copying the
 * user's words; code finds the row and does the date arithmetic, which small
 * models get wrong.
 *
 * A loop of one action per call was tried first. Small models repeat an
 * action they have just been told succeeded, so "remind me to shower" became
 * four tasks; a single plan cannot do that. The `kind` gate comes first
 * because, left to fill an actions array, models act on plain questions.
 */
export const CHAT_SYSTEM = `You are AmbientMind, the task assistant on {userName}'s Mac. You are talking to {userName}. Nothing leaves this Mac.
{aboutBlock}
Now: {currentTime}

Open tasks, most urgent first:
{taskDigest}

Done recently:
{doneDigest}

Repeating:
{ruleDigest}
{decisionDigest}
First decide "kind":
- "change": {userName} asks you to add, move, rename, finish, reopen, hide, delete or repeat something. "Remind me to…", "add…", "I need to…", "I did…", "already sorted it", "drop…" and "cancel…" are changes.
- "question": {userName} asks about the tasks. Answer from the lists above, counting only open tasks unless asked otherwise.
- "other": anything else, like greetings, {userName}'s name (it is {userName}) or what you can do.
Only a change has actions; otherwise "actions" is [].

Actions:
- add: a new task. "title" is short and starts with a verb.
- update: change an existing task: a new "when", a new "title" or a new "priority".
- done: {userName} finished it.
- reopen: a task from "Done recently" is not finished after all.
- snooze: hide it until "when".
- delete: remove it.
- repeat: a weekly commitment. "when" holds the days and time in {userName}'s words, like "every Monday and Wednesday at 7am".
"task" is the existing task's title, copied exactly from the lists above. "when" copies {userName}'s own words, like "in an hour" or "tomorrow at 10am"; never work out dates yourself. Leave a field null when it doesn't apply.
When {userName} corrects something just done ("I said in an hour"), update that task; never add it again.

"reply" is one or two short sentences in plain words. Say when things are due the way a person would ("tomorrow at 5 PM"). If you don't know something, say so.
Past decisions are history: use them to answer "did I already deal with this?", never act on them unasked.

Examples, for an imaginary list with "Send the Q3 report" (due today at 5 PM) and "Review Daniel's pull request" (due Thursday):
User: what's due today?
{"kind":"question","actions":[],"reply":"Just the Q3 report, at 5 PM."}
User: remind me to call the dentist tomorrow at 10am
{"kind":"change","actions":[{"type":"add","task":null,"title":"Call the dentist","when":"tomorrow at 10am","priority":null}],"reply":"Added for tomorrow at 10 AM."}
User: actually make it 11
{"kind":"change","actions":[{"type":"update","task":"Call the dentist","title":null,"when":"tomorrow at 11am","priority":null}],"reply":"Moved to 11 AM."}
User: I sent the report
{"kind":"change","actions":[{"type":"done","task":"Send the Q3 report","title":null,"when":null,"priority":null}],"reply":"Marked it done."}
User: push the review to Monday
{"kind":"change","actions":[{"type":"snooze","task":"Review Daniel's pull request","title":null,"when":"Monday","priority":null}],"reply":"Hidden until Monday."}
User: I have gym every Monday and Wednesday at 7am
{"kind":"change","actions":[{"type":"repeat","task":null,"title":"Gym","when":"every Monday and Wednesday at 7am","priority":null}],"reply":"Set up for Mondays and Wednesdays at 7."}
User: forget the review, not doing it
{"kind":"change","actions":[{"type":"delete","task":"Review Daniel's pull request","title":null,"when":null,"priority":null}],"reply":"Deleted it."}
User: what's my name?
{"kind":"other","actions":[],"reply":"You're {userName}."}`

export const CHAT_SCHEMA = {
  type: 'object',
  properties: {
    kind: { type: 'string', enum: CHAT_KINDS },
    actions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: CHAT_ACTIONS },
          task: { anyOf: [{ type: 'string' }, { type: 'null' }] },
          title: { anyOf: [{ type: 'string' }, { type: 'null' }] },
          when: { anyOf: [{ type: 'string' }, { type: 'null' }] },
          priority: { anyOf: [{ type: 'string', enum: ['low', 'medium', 'high', 'urgent'] }, { type: 'null' }] }
        },
        required: ['type', 'task', 'title', 'when', 'priority']
      }
    },
    reply: { type: 'string' }
  },
  required: ['kind', 'actions', 'reply']
} as const

export function buildChatSystem(vars: ChatVars): string {
  const dict = vars as unknown as Record<string, string>
  return CHAT_SYSTEM.replace(/\{(\w+)\}/g, (match, key: string) => dict[key] ?? match)
}
