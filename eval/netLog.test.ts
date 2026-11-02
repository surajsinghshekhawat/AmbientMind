import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { clearNetworkLog, installNetworkLog, networkSummary, readRequests } from '../electron/services/netLog'

const root = join(process.cwd(), '.local', 'tmp')
mkdirSync(root, { recursive: true })
const dir = mkdtempSync(join(root, 'netlog-'))
after(() => rmSync(dir, { recursive: true, force: true }))

test('requests that leave the Mac are logged without their query; local ones are only counted', async () => {
  const original = globalThis.fetch
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (url.includes('fail.example')) throw new TypeError('fetch failed')
    return new Response('{}', { status: url.includes('denied') ? 403 : 200 })
  }) as typeof fetch
  const path = join(dir, 'network.jsonl')
  try {
    installNetworkLog(path)
    // Installing twice must not wrap twice.
    installNetworkLog(path)
    await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages?q=newer_than:2d&secret=1')
    await fetch('https://www.googleapis.com/calendar/v3/denied', { method: 'POST' })
    await fetch('http://127.0.0.1:11435/api/tags')
    await assert.rejects(fetch('https://fail.example/x'))

    const logged = readRequests(path)
    assert.deepEqual(
      logged.map((r) => [r.method, r.host, r.path, r.status]),
      [
        ['GET', 'gmail.googleapis.com', '/gmail/v1/users/me/messages', 200],
        ['POST', 'www.googleapis.com', '/calendar/v3/denied', 403],
        ['GET', 'fail.example', '/x', null]
      ]
    )
    assert.ok(!JSON.stringify(logged).includes('secret'))
    const summary = networkSummary()
    assert.equal(summary.localSinceLaunch, 1)
    assert.equal(summary.destinations.find((d) => d.destination === 'google')?.requests, 2)

    clearNetworkLog()
    assert.deepEqual(readRequests(path), [])
  } finally {
    globalThis.fetch = original
  }
})
