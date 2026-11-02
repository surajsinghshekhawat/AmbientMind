import assert from 'node:assert/strict'
import test, { afterEach } from 'node:test'
import { getAccessToken, isGoogleConnected } from '../../electron/services/googleAuth'
import { setJson } from '../../electron/services/secrets'
import { runSync } from '../../electron/services/sync'
import { listActive, listSyncStates } from '../../electron/services/taskStore'
import { freshStore, json, mockFetch } from './helpers'

process.env.GOOGLE_CLIENT_ID = 'test-client'
process.env.GOOGLE_CLIENT_SECRET = 'test-secret'

let restore: (() => void) | null = null
afterEach(() => {
  restore?.()
  restore = null
})

function signIn(expiresAt = Date.now() + 3_600_000) {
  setJson('google.tokens', {
    accessToken: 'access',
    refreshToken: 'refresh',
    expiresAt,
    scope: 'openid email'
  })
}

const upcomingMeeting = () => ({
  items: [
    {
      id: 'evt-1',
      summary: 'Design review',
      status: 'confirmed',
      start: { dateTime: new Date(Date.now() + 5 * 3_600_000).toISOString() },
      attendees: [{ self: true, responseStatus: 'accepted' }, { email: 'sam@example.com' }]
    }
  ]
})

test('a revoked Google grant disconnects the account and says to reconnect', async () => {
  freshStore()
  signIn(0)
  restore = mockFetch(() =>
    json(400, { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' })
  )

  await assert.rejects(getAccessToken(), /reconnect/i)
  assert.equal(isGoogleConnected(), false)
})

test('a temporary refresh failure keeps the account connected', async () => {
  freshStore()
  signIn(0)
  restore = mockFetch(() => json(500, { error: 'internal_failure' }))

  await assert.rejects(getAccessToken())
  assert.equal(isGoogleConnected(), true)
})

test('calendar still imports and the error is recorded when Ollama is down', async () => {
  freshStore()
  signIn()
  restore = mockFetch((url) => {
    if (url.includes('/api/tags')) throw new TypeError('fetch failed')
    if (url.includes('/calendar/v3/')) return json(200, upcomingMeeting())
    return json(404, {})
  })

  const report = await runSync()

  assert.match(report.errors.join('\n'), /Ollama/)
  assert.deepEqual(
    listActive().map((task) => task.title),
    ['Prepare for Design review']
  )
  const gmail = listSyncStates().find((state) => state.source === 'gmail')
  assert.match(gmail?.lastError ?? '', /Ollama/)
})

test('an unexpected failure is reported instead of thrown, and recorded', async () => {
  freshStore()
  signIn()
  restore = mockFetch((url) => {
    if (url.includes('/api/tags')) return json(200, { models: [] })
    if (url.includes('/calendar/v3/')) return json(200, upcomingMeeting())
    throw new Error('mail exploded')
  })

  const report = await runSync()
  assert.ok(report.errors.length > 0)
  const gmail = listSyncStates().find((state) => state.source === 'gmail')
  assert.ok(gmail?.lastError)
})
