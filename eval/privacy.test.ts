import assert from 'node:assert/strict'
import test from 'node:test'
import { sanitizeConfig } from '../shared/config'
import {
  DEFAULT_OLLAMA_URL,
  destinationOf,
  isLoopback,
  localOllamaUrl,
  safePath,
  summariseNetwork,
  type NetworkRequest
} from '../shared/network'
import {
  describePause,
  isAiPaused,
  isPausedUntilResumed,
  normalizePauseAiUntil,
  PAUSE_UNTIL_RESUMED,
  pauseEnds
} from '../shared/pauseAi'
import { cutoffFor, isErasableSource } from '../shared/privacy'
import { quietReason } from '../shared/quiet'
import { userExcluded } from '../shared/screenRead'
import { DEFAULT_CONFIG } from '../shared/types'

const NOW = Date.parse('2026-11-01T10:00:00.000Z')

const request = (host: string, status: number | null = 200, at = '2026-11-01T09:00:00.000Z'): NetworkRequest => ({
  at,
  method: 'GET',
  host,
  path: '/',
  status,
  ms: 10,
  via: 'main'
})

test('requests are grouped by where they went', () => {
  assert.equal(destinationOf('gmail.googleapis.com'), 'google')
  assert.equal(destinationOf('oauth2.googleapis.com'), 'google')
  assert.equal(destinationOf('accounts.google.com'), 'google')
  assert.equal(destinationOf('huggingface.co'), 'model-download')
  assert.equal(destinationOf('cdn-lfs.hf.co'), 'model-download')
  assert.equal(destinationOf('cdn.jsdelivr.net'), 'model-download')
  assert.equal(destinationOf('127.0.0.1:11435'), 'this-mac')
  assert.equal(destinationOf('localhost'), 'this-mac')
  assert.equal(destinationOf('example.com'), 'other')
  // A lookalike is not Google.
  assert.equal(destinationOf('google.com.evil.example'), 'other')
  assert.equal(isLoopback('127.0.0.2'), true)
  assert.equal(isLoopback('10.0.0.1'), false)
  assert.equal(isLoopback('::1'), true)
  assert.equal(isLoopback('[::1]:11434'), true)
  // A name that merely starts like a loopback address is somewhere else.
  assert.equal(isLoopback('127.evil.example'), false)
  assert.equal(destinationOf('127.0.0.1.evil.example'), 'other')
  assert.equal(isLoopback('127.0.0.300'), false)
})

test('Ollama may only be overridden to a loopback IP over http', () => {
  assert.equal(localOllamaUrl(undefined), DEFAULT_OLLAMA_URL)
  assert.equal(localOllamaUrl('http://127.0.0.1:11435'), 'http://127.0.0.1:11435')
  assert.equal(localOllamaUrl('http://[::1]:11435/'), 'http://[::1]:11435')
  for (const raw of ['http://192.168.1.20:11434', 'https://127.0.0.1:11434', 'http://localhost:11434', 'http://127.evil.example', 'nonsense']) {
    assert.equal(localOllamaUrl(raw), DEFAULT_OLLAMA_URL, raw)
  }
})

test('logged paths drop long opaque ids', () => {
  assert.equal(safePath('/gmail/v1/users/me/messages/18c2f4a9b7e6d5c4b3a2f1e0d9'), '/gmail/v1/users/me/messages/…')
  assert.equal(safePath('/calendar/v3/calendars/primary/events'), '/calendar/v3/calendars/primary/events')
})

test('the network summary counts, fails and orders destinations', () => {
  const summary = summariseNetwork(
    [
      request('www.googleapis.com'),
      request('gmail.googleapis.com', 403, '2026-11-01T09:30:00.000Z'),
      request('huggingface.co', null),
      request('example.com')
    ],
    12
  )
  assert.deepEqual(
    summary.destinations.map((d) => [d.destination, d.requests, d.failed]),
    [
      ['google', 2, 1],
      ['model-download', 1, 1],
      ['other', 1, 0]
    ]
  )
  assert.equal(summary.destinations[0]!.lastAt, '2026-11-01T09:30:00.000Z')
  assert.equal(summary.recent[0]!.host, 'example.com')
  assert.equal(summary.localSinceLaunch, 12)
})

test('a pause until resumed is still a timestamp, and reads as one', () => {
  assert.equal(normalizePauseAiUntil(PAUSE_UNTIL_RESUMED, NOW), PAUSE_UNTIL_RESUMED)
  assert.equal(isAiPaused(PAUSE_UNTIL_RESUMED, NOW), true)
  assert.equal(isPausedUntilResumed(PAUSE_UNTIL_RESUMED), true)
  assert.equal(isPausedUntilResumed('2026-11-01T11:00:00.000Z'), false)
  assert.match(describePause(PAUSE_UNTIL_RESUMED, NOW), /until you resume it/)
})

test('a pause ending tomorrow says tomorrow', () => {
  const tomorrow = new Date(NOW)
  tomorrow.setDate(tomorrow.getDate() + 1)
  tomorrow.setHours(8, 0, 0, 0)
  assert.match(pauseEnds(tomorrow.toISOString(), NOW), /^until tomorrow at /)
  assert.doesNotMatch(pauseEnds(new Date(NOW + 30 * 60_000).toISOString(), NOW), /tomorrow/)
})

test('new privacy settings default to off, except quiet mode', () => {
  const config = sanitizeConfig({})
  assert.equal(config.screenReading, false)
  assert.equal(config.contentProtection, false)
  assert.equal(config.quietMode, true)
  assert.deepEqual(config.excludedApps, [])
  assert.equal(DEFAULT_CONFIG.screenReading, false)
})

test('excluded apps are trimmed, de-duplicated and must be strings', () => {
  const config = sanitizeConfig({ excludedApps: [' Messages ', '', 'messages', 'com.apple.MobileSMS', 3] as unknown as string[] })
  assert.deepEqual(config.excludedApps, ['Messages', 'com.apple.MobileSMS'])
  assert.deepEqual(sanitizeConfig({ excludedApps: 'Messages' as unknown as string[] }).excludedApps, [])
})

test('an app the user excluded is matched by name, bundle id or window title', () => {
  const excluded = ['Messages', 'com.tinyspeck.slackmacgap']
  assert.equal(userExcluded(excluded, { name: 'messages', bundleId: 'com.apple.MobileSMS' }), 'Messages')
  assert.equal(userExcluded(excluded, { name: 'Slack', bundleId: 'com.tinyspeck.slackmacgap' }), 'com.tinyspeck.slackmacgap')
  assert.equal(userExcluded(excluded, { name: 'Mail', bundleId: 'com.apple.mail' }), null)
  // Without the helper, only the window title is known.
  assert.equal(userExcluded(excluded, { windowTitle: 'Chat with Sam — Messages' }), 'Messages')
  assert.equal(userExcluded(excluded, { windowTitle: 'Messages about the launch — Mail' }), null)
  // A known app name wins over a title that happens to match.
  assert.equal(userExcluded(excluded, { name: 'Notes', windowTitle: 'Messages' }), null)
})

test('quiet during a call, but not while Quick Capture is listening', () => {
  assert.equal(quietReason({ idleSeconds: 0, micInUse: true, fullscreenApp: null }, false), 'call')
  assert.equal(quietReason({ idleSeconds: 0, micInUse: true, fullscreenApp: null }, true), null)
  assert.equal(quietReason({ idleSeconds: 0, micInUse: false, fullscreenApp: 'Keynote' }, false), 'fullscreen')
  assert.equal(quietReason({ idleSeconds: 300, micInUse: false, fullscreenApp: null }, false), null)
})

test('only sources that won’t sync straight back can be forgotten', () => {
  assert.equal(isErasableSource('gmail'), true)
  assert.equal(isErasableSource('screen'), true)
  assert.equal(isErasableSource('reminders'), false)
  assert.equal(isErasableSource('rule'), false)
  assert.equal(isErasableSource('nonsense'), false)
  assert.equal(cutoffFor(30, NOW), '2026-10-02T10:00:00.000Z')
})
