import assert from 'node:assert/strict'
import test from 'node:test'
import { qaFolderAllowed, qaRequestAllowed } from '../shared/qaPolicy'

const ROOT = '/Users/me/AmbientMind'

test('QA runs only on a copy inside a run folder', () => {
  assert.equal(qaFolderAllowed(`${ROOT}/.local/qa/runs/2026-11-02/data`), true)
  assert.equal(qaFolderAllowed(`${ROOT}/.local/data`), false)
  assert.equal(qaFolderAllowed(`${ROOT}/.local/qa/runs/2026-11-02`), false, 'the run folder itself, not a data folder in it')
  assert.equal(qaFolderAllowed(`${ROOT}/.local/qa/runs/x/../../../data`), false)
  assert.equal(qaFolderAllowed(`${ROOT}/.local/qa/runs/x/.local/data`), false)
  assert.equal(qaFolderAllowed(undefined), false)
  assert.equal(qaFolderAllowed('/tmp/qa/runs/x/data'), false)
  assert.equal(qaFolderAllowed(`${ROOT}/.local/qa/runs/x/data`, `${ROOT}/.local/qa/runs/x/data/`), false)
})

test('your mail and calendar can be read', () => {
  assert.deepEqual(qaRequestAllowed({ url: 'https://gmail.googleapis.com/gmail/v1/users/me/messages?q=newer_than:2d' }), { allowed: true })
  assert.deepEqual(qaRequestAllowed({ url: 'https://www.googleapis.com/calendar/v3/calendars/primary/events' }), { allowed: true })
  assert.deepEqual(qaRequestAllowed({ url: 'https://www.googleapis.com/oauth2/v3/userinfo' }), { allowed: true })
  assert.deepEqual(
    qaRequestAllowed({ url: 'https://oauth2.googleapis.com/token', method: 'POST', body: 'grant_type=refresh_token&refresh_token=x' }),
    { allowed: true }
  )
})

test('nothing at Google can be changed, revoked or signed in again', () => {
  const blocked = [
    { url: 'https://www.googleapis.com/calendar/v3/calendars/primary/events', method: 'POST' },
    { url: 'https://www.googleapis.com/calendar/v3/calendars/x/events/y', method: 'DELETE' },
    { url: 'https://www.googleapis.com/calendar/v3/calendars/x/events/y', method: 'PATCH' },
    { url: 'https://gmail.googleapis.com/gmail/v1/users/me/messages/x/modify', method: 'POST' },
    { url: 'https://oauth2.googleapis.com/revoke', method: 'POST', body: 'token=x' },
    { url: 'https://oauth2.googleapis.com/token', method: 'POST', body: 'grant_type=authorization_code&code=x' },
    { url: 'https://oauth2.googleapis.com/token', method: 'POST' },
    { url: 'https://accounts.google.com/o/oauth2/v2/auth' }
  ]
  for (const request of blocked) assert.equal(qaRequestAllowed(request).allowed, false, `${request.method ?? 'GET'} ${request.url}`)
})

test('only this machine and the read calls are reachable', () => {
  assert.equal(qaRequestAllowed({ url: 'http://127.0.0.1:11435/api/chat', method: 'POST' }).allowed, true)
  assert.equal(qaRequestAllowed({ url: 'http://localhost:5173/src/overlay/index.html' }).allowed, true)
  assert.equal(qaRequestAllowed({ url: 'file:///Users/me/AmbientMind/out/renderer/overlay/index.html' }).allowed, true)
  assert.equal(qaRequestAllowed({ url: 'https://huggingface.co/Xenova/whisper-base.en/resolve/main/config.json' }).allowed, false)
  assert.equal(qaRequestAllowed({ url: 'https://example.com/' }).allowed, false)
  assert.equal(qaRequestAllowed({ url: 'https://gmail.googleapis.com.evil.example/gmail/v1/' }).allowed, false)
  assert.equal(qaRequestAllowed({ url: 'not a url' }).allowed, false)
})
