import assert from 'node:assert/strict'
import test from 'node:test'
import { describeGoogleError, isScopeError } from '../shared/googleError'

const body = (code: number, message: string, status: string) =>
  JSON.stringify({ error: { code, message, errors: [{ message, domain: 'global' }], status } })

test("Google's message is shown without the JSON around it", () => {
  const text = describeGoogleError('Calendar', 404, body(404, 'Not Found', 'NOT_FOUND'))
  assert.equal(text, 'Calendar 404: Not Found')
  assert.doesNotMatch(text, /[{}"]/)
})

test('a missing scope still reads as one, so Settings can ask to reconnect', () => {
  const text = describeGoogleError('Gmail', 403, body(403, 'Request had insufficient authentication scopes.', 'PERMISSION_DENIED'))
  assert.ok(isScopeError(text))
})

test('server trouble and rate limits say it will try again', () => {
  assert.match(describeGoogleError('Calendar', 500, body(500, 'Internal error encountered.', 'INTERNAL')), /problem on its side \(500\).*try again/)
  assert.match(describeGoogleError('Gmail', 429, body(429, 'Too many requests', 'RESOURCE_EXHAUSTED')), /limiting requests/)
  assert.match(describeGoogleError('Gmail', 403, body(403, 'User rate limit exceeded.', 'PERMISSION_DENIED')), /limiting requests/)
})

test('an HTML error page becomes short plain text', () => {
  const text = describeGoogleError('Gmail', 400, `<html><body><h1>Bad Request</h1>${'x'.repeat(400)}</body></html>`)
  assert.doesNotMatch(text, /</)
  assert.ok(text.length < 200)
  assert.equal(describeGoogleError('Gmail', 401, ''), 'Gmail 401')
})
