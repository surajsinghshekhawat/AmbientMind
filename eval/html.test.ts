import assert from 'node:assert/strict'
import test from 'node:test'
import { stripHtml } from '../shared/html'

test('HTML mail reads as text, with styles and scripts gone', () => {
  const text = stripHtml(
    '<html><style>p { color: red }</style><p>Can you send the deck</p><div>by Friday?<br/>Thanks</div><script>x()</script>&amp; &lt;3</html>'
  )
  assert.equal(text.replace(/\s+/g, ' ').trim(), 'Can you send the deck by Friday? Thanks & <3')
  assert.match(stripHtml('<p>One</p><p>Two</p>'), /One\n.*Two/s)
})

test('a stray "<" in text is kept', () => {
  assert.equal(stripHtml('if a < b then'), 'if a < b then')
})

test('a crafted mail is stripped in linear time', () => {
  for (const hostile of ['<style'.repeat(80_000), '<'.repeat(400_000), '<a'.repeat(200_000) + '>', '<script>'.repeat(60_000)]) {
    const started = performance.now()
    stripHtml(hostile)
    const ms = performance.now() - started
    assert.ok(ms < 500, `${hostile.slice(0, 8)}… took ${Math.round(ms)}ms`)
  }
})
