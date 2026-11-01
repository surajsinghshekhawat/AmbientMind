/**
 * A local stand-in for the Gmail, Calendar and OAuth endpoints AmbientMind
 * reads, serving the labelled corpus (docs/AGENT_QA.md, M3 and M5). QA mode
 * sends Google traffic here when AMBIENTMIND_QA_GOOGLE points at it.
 *
 *   node scripts/fake-google.cjs --port 0 --corpus eval/corpus/seed.jsonl --log <file>
 *
 * Prints {"port":N,"answers":<path>} once listening. The moved dates and
 * gold deadlines are written to the answers file for scoring.
 *
 * POST /__fault {"mode":"none|500|429|slow|malformed|drop","times":N} injects faults.
 */
const http = require('node:http')
const { appendFileSync, readFileSync, writeFileSync } = require('node:fs')
const { parseArgs } = require('node:util')

const { values } = parseArgs({
  options: {
    port: { type: 'string', default: '0' },
    corpus: { type: 'string', default: 'eval/corpus/seed.jsonl' },
    log: { type: 'string' },
    answers: { type: 'string' },
    email: { type: 'string', default: 'sally.beck@enron.com' },
    name: { type: 'string', default: 'Sally Beck' }
  }
})

const corpus = readFileSync(values.corpus, 'utf8')
  .split('\n')
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith('//'))
  .map((l) => JSON.parse(l))

// Each message moves by whole weeks into the last seven days, which keeps its
// weekday and time of day ("by Friday morning" stays a Friday), and its gold
// deadlines move with it. The list call ignores newer_than so all are read.
const WEEK = 7 * 86_400_000
const messages = corpus.map((m, i) => {
  const shift = Math.floor((Date.now() - Date.parse(m.sentAt)) / WEEK) * WEEK
  const moved = (iso) => (iso ? new Date(Date.parse(iso) + shift).toISOString() : null)
  return {
    ...m,
    gmailId: `qa${String(i).padStart(4, '0')}`,
    sentAt: moved(m.sentAt),
    goldTasks: m.goldTasks.map((t) => ({ ...t, deadline: moved(t.deadline) }))
  }
})
if (values.answers) writeFileSync(values.answers, JSON.stringify(messages, null, 2))

// Two days of meetings, one of which repeats a task the mail also asks for.
const hour = (h) => new Date(Date.now() + h * 3_600_000).toISOString()
const firstGold = messages.find((m) => m.goldTasks.length)?.goldTasks[0]
const events = [
  { id: 'qa-ev-1', iCalUID: 'qa-ev-1@google.com', status: 'confirmed', summary: 'Weekly risk review', start: { dateTime: hour(20) }, end: { dateTime: hour(21) }, attendees: [{ email: values.email, self: true }, { email: 'rick.buy@enron.com' }] },
  { id: 'qa-ev-2', iCalUID: 'qa-ev-2@google.com', status: 'confirmed', summary: firstGold ? firstGold.title : 'Board pack review', start: { dateTime: hour(30) }, end: { dateTime: hour(31) } },
  { id: 'qa-ev-3', iCalUID: 'qa-ev-3@google.com', status: 'cancelled', summary: 'Cancelled sync', start: { dateTime: hour(10) }, end: { dateTime: hour(11) } }
]

/** As a mail client writes it: local time and offset ("Mon, 3 Nov 2026 09:14:00 +0530"), not GMT. */
function mailDate(iso) {
  const d = new Date(iso)
  const pad = (n) => String(n).padStart(2, '0')
  const offset = -d.getTimezoneOffset()
  const zone = `${offset >= 0 ? '+' : '-'}${pad(Math.floor(Math.abs(offset) / 60))}${pad(Math.abs(offset) % 60)}`
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()]
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()]
  return `${day}, ${d.getDate()} ${month} ${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())} ${zone}`
}

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

function full(m) {
  const headers = [
    { name: 'From', value: m.sender },
    { name: 'To', value: m.recipients },
    { name: 'Subject', value: m.subject },
    { name: 'Date', value: mailDate(m.sentAt) }
  ]
  if (/unsubscribe/i.test(m.body)) headers.push({ name: 'List-Unsubscribe', value: '<mailto:unsubscribe@example.com>' })
  return {
    id: m.gmailId,
    threadId: m.gmailId,
    internalDate: String(Date.parse(m.sentAt)),
    payload: { mimeType: 'multipart/alternative', headers, parts: [{ mimeType: 'text/plain', body: { data: b64(m.body), size: m.body.length } }] }
  }
}

let fault = { mode: 'none', times: 0 }

function log(entry) {
  if (values.log) appendFileSync(values.log, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`)
}

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(typeof body === 'string' ? body : JSON.stringify(body))
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1')
  let body = ''
  req.on('data', (c) => (body += c))
  req.on('end', () => {
    // Bodies are never logged: the token request carries a (fake) refresh token.
    log({ method: req.method, path: url.pathname, query: url.search, fault: fault.mode })
    if (url.pathname === '/__fault') {
      fault = { mode: 'none', times: 0, ...JSON.parse(body || '{}') }
      return send(res, 200, fault)
    }
    if (fault.mode !== 'none' && fault.times !== 0) {
      fault.times--
      const mode = fault.mode
      if (fault.times === 0) fault = { mode: 'none', times: 0 }
      if (mode === '500') return send(res, 500, { error: { code: 500, message: 'Backend Error' } })
      if (mode === '429') return send(res, 429, { error: { code: 429, message: 'Rate Limit Exceeded' } })
      if (mode === 'malformed') return send(res, 200, '{"messages": [ {"id": ')
      if (mode === 'drop') return req.socket.destroy()
      if (mode === 'slow') return setTimeout(() => route(req, url, res), 20_000)
    }
    route(req, url, res)
  })
})

function route(req, url, res) {
  const p = url.pathname
  if (p === '/token' && req.method === 'POST') {
    return send(res, 200, { access_token: `qa-access-${Date.now()}`, expires_in: 3600, token_type: 'Bearer', scope: 'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/calendar.readonly' })
  }
  if (p === '/oauth2/v3/userinfo') return send(res, 200, { email: values.email, name: values.name, given_name: values.name.split(' ')[0] })
  if (p === '/gmail/v1/users/me/profile') return send(res, 200, { emailAddress: values.email })
  if (p === '/gmail/v1/users/me/messages') {
    const list = messages.map((m) => ({ id: m.gmailId, threadId: m.gmailId }))
    return send(res, 200, { messages: list, resultSizeEstimate: list.length })
  }
  const one = /^\/gmail\/v1\/users\/me\/messages\/([^/]+)$/.exec(p)
  if (one) {
    const m = messages.find((x) => x.gmailId === one[1])
    return m ? send(res, 200, full(m)) : send(res, 404, { error: { code: 404, message: 'Not Found' } })
  }
  if (/^\/calendar\/v3\/calendars\/[^/]+\/events$/.test(p) && req.method === 'GET') {
    return send(res, 200, { items: events })
  }
  if (p.startsWith('/calendar/v3/users/me/calendarList')) return send(res, 200, { items: [{ id: 'primary', primary: true, summary: values.email }] })
  send(res, 404, { error: { code: 404, message: `fake-google has no ${req.method} ${p}` } })
}

server.listen(Number(values.port), '127.0.0.1', () => {
  console.log(JSON.stringify({ port: server.address().port, answers: values.answers ?? null }))
})
