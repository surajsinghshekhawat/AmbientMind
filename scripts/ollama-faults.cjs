/**
 * A proxy between one QA instance and the project Ollama that injects faults
 * on request (docs/AGENT_QA.md, M5). The Ollama your app uses is untouched.
 *
 *   node scripts/ollama-faults.cjs --port 0 --target http://127.0.0.1:11435 --log <file>
 *
 * Prints {"port":N} once listening.
 * POST /__fault {"mode":"none|slow|drop|500|malformed|hang","times":N,"paths":"/api/chat"}
 * applies to the next N matching requests (-1: until changed).
 */
const http = require('node:http')
const { appendFileSync } = require('node:fs')
const { parseArgs } = require('node:util')

const { values } = parseArgs({
  options: {
    port: { type: 'string', default: '0' },
    target: { type: 'string', default: process.env.OLLAMA_URL ?? 'http://127.0.0.1:11435' },
    log: { type: 'string' }
  }
})
const target = new URL(values.target)
if (!['127.0.0.1', 'localhost'].includes(target.hostname)) throw new Error('the target must be on this machine')

let fault = { mode: 'none', times: 0, paths: '' }

function log(entry) {
  if (values.log) appendFileSync(values.log, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`)
}

function forward(req, res, body, mangle) {
  const upstream = http.request(
    { hostname: target.hostname, port: target.port, path: req.url, method: req.method, headers: { ...req.headers, host: target.host } },
    (up) => {
      if (!mangle) {
        res.writeHead(up.statusCode ?? 502, up.headers)
        return up.pipe(res)
      }
      let text = ''
      up.on('data', (c) => (text += c))
      up.on('end', () => {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(text.slice(0, Math.max(1, Math.floor(text.length / 2))))
      })
    }
  )
  upstream.on('error', (err) => {
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: err.message }))
  })
  upstream.end(body)
}

const server = http.createServer((req, res) => {
  const chunks = []
  req.on('data', (c) => chunks.push(c))
  req.on('end', () => {
    const body = Buffer.concat(chunks)
    if (req.url === '/__fault') {
      fault = { mode: 'none', times: 0, paths: '', ...JSON.parse(body.toString() || '{}') }
      res.writeHead(200, { 'content-type': 'application/json' })
      return res.end(JSON.stringify(fault))
    }
    const applies = fault.mode !== 'none' && fault.times !== 0 && (!fault.paths || req.url.startsWith(fault.paths))
    const mode = applies ? fault.mode : 'none'
    if (applies && fault.times > 0 && --fault.times === 0) fault = { mode: 'none', times: 0, paths: '' }
    const started = Date.now()
    res.on('finish', () => log({ method: req.method, path: req.url, fault: mode, status: res.statusCode, ms: Date.now() - started }))
    res.on('close', () => !res.writableFinished && log({ method: req.method, path: req.url, fault: mode, status: 'closed', ms: Date.now() - started }))
    if (mode === 'drop') return req.socket.destroy()
    if (mode === 'hang') return
    if (mode === '500') {
      res.writeHead(500, { 'content-type': 'application/json' })
      return res.end(JSON.stringify({ error: 'injected failure' }))
    }
    if (mode === 'slow') return setTimeout(() => forward(req, res, body, false), 25_000)
    forward(req, res, body, mode === 'malformed')
  })
})

server.listen(Number(values.port), '127.0.0.1', () => console.log(JSON.stringify({ port: server.address().port })))
