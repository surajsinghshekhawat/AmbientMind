/**
 * Stands in for the Swift helper in helperClient tests. Speaks the same
 * line protocol; the first argument picks a behaviour:
 *
 *   ok                  answers hello, echo, slow (never), crash (exits), event
 *   protocol2           claims a protocol the app does not speak
 *   mute                never answers hello
 *   crash-first <file>  exits at start the first two launches, counting in <file>
 */
const { existsSync, readFileSync, writeFileSync } = require('node:fs')
const readline = require('node:readline')

const [mode, counterFile] = process.argv.slice(2)

if (mode === 'crash-first') {
  const launches = (existsSync(counterFile) ? Number(readFileSync(counterFile, 'utf8')) : 0) + 1
  writeFileSync(counterFile, String(launches))
  if (launches <= 2) process.exit(3)
}

const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`)

readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const { id, method, params } = JSON.parse(line)
  if (method === 'hello') {
    if (mode === 'mute') return
    return send({ id, ok: true, result: { version: 'fake', protocol: mode === 'protocol2' ? 2 : 1, macOS: 'test', pid: process.pid, responsibleApp: null, features: [] } })
  }
  if (method === 'echo') return send({ id, ok: true, result: params })
  if (method === 'fail') return send({ id, ok: false, error: { code: 'permission_denied', message: 'no' } })
  if (method === 'slow') return
  if (method === 'crash') process.exit(1)
  if (method === 'event') {
    send({ event: 'ping', data: { n: 1 } })
    // A reply split across writes, as a pipe may deliver it.
    const text = JSON.stringify({ id, ok: true, result: { done: 'ünïcødé' } })
    process.stdout.write(text.slice(0, 7))
    setTimeout(() => process.stdout.write(`${text.slice(7)}\n`), 20)
    return
  }
  send({ id, ok: false, error: { code: 'unknown_method', message: `No method ${method}` } })
}).on('close', () => process.exit(0))
