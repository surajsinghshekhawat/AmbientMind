import assert from 'node:assert/strict'
import test from 'node:test'
import { allowPermission, contentSecurityPolicy, isAppUrl } from '../electron/security'

const DEV = 'http://localhost:5173'

test('only the bundled pages, or the dev server in development, count as the app', () => {
  assert.equal(isAppUrl('file:///Applications/AmbientMind.app/Contents/Resources/app.asar/out/renderer/overlay/index.html'), true)
  assert.equal(isAppUrl(`${DEV}/settings/index.html`, DEV), true)
  assert.equal(isAppUrl(`${DEV}/settings/index.html`), false, 'no dev server in a packaged build')
  assert.equal(isAppUrl('http://localhost:5174/x', DEV), false)
  assert.equal(isAppUrl('https://evil.example/'), false)
  assert.equal(isAppUrl('not a url'), false)
})

test('the microphone is the only permission, and only for our pages', () => {
  const ours = `${DEV}/quickadd/index.html`
  assert.equal(allowPermission('media', { mediaTypes: ['audio'], url: ours, devServerUrl: DEV }), true)
  assert.equal(allowPermission('media', { mediaTypes: ['video'], url: ours, devServerUrl: DEV }), false)
  assert.equal(allowPermission('media', { mediaTypes: ['audio', 'video'], url: ours, devServerUrl: DEV }), false)
  assert.equal(allowPermission('media', { mediaTypes: ['audio'], url: 'https://evil.example/' }), false)
  assert.equal(allowPermission('mediaKeySystem', { url: ours, devServerUrl: DEV }), false)
  assert.equal(allowPermission('notifications', { url: ours, devServerUrl: DEV }), false)
})

test('the policy forbids remote and inline script in production and stays usable in dev', () => {
  const prod = contentSecurityPolicy()
  assert.match(prod, /script-src 'self'(;|$)/)
  assert.match(prod, /object-src 'none'/)
  assert.doesNotMatch(prod, /unsafe-eval/)

  const dev = contentSecurityPolicy(DEV)
  assert.match(dev, /connect-src 'self' ws:\/\/localhost:5173/)
  assert.doesNotMatch(dev, /\*/)
})
