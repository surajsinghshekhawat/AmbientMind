import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { prefixFor } from '../electron/services/ollama'
import {
  EXAMPLE_TEXT_CHARS,
  messageIdFromTask,
  truncateExample
} from '../electron/services/vectorStore'

test('nomic models get the asymmetric document and query prefixes', () => {
  assert.equal(prefixFor('nomic-embed-text', 'document'), 'search_document: ')
  assert.equal(prefixFor('nomic-embed-text', 'query'), 'search_query: ')
  assert.equal(prefixFor('nomic-embed-text:latest', 'query'), 'search_query: ')
})

test('the two prefixes differ, or the asymmetry is pointless', () => {
  assert.notEqual(
    prefixFor('nomic-embed-text', 'document'),
    prefixFor('nomic-embed-text', 'query')
  )
})

test('non-nomic models are left alone', () => {
  // Any other model reads these as ordinary words and would be worse for them.
  assert.equal(prefixFor('mxbai-embed-large', 'document'), '')
  assert.equal(prefixFor('all-minilm', 'query'), '')
})

test('a gmail task resolves to the message that produced it', () => {
  assert.equal(
    messageIdFromTask({ source: 'gmail', sourceId: '18f2a1b3c4d5e6f7:Send the Q1 numbers' }),
    '18f2a1b3c4d5e6f7'
  )
})

test('tasks with no extracted example cannot be rated', () => {
  // Only mail goes through the model with an example stored beside it.
  assert.equal(messageIdFromTask({ source: 'manual', sourceId: 'whatever:thing' }), null)
  assert.equal(messageIdFromTask({ source: 'voice', sourceId: 'abc' }), null)
  assert.equal(messageIdFromTask({ source: 'rule', sourceId: 'rule-1:2026-09-16' }), null)
  assert.equal(messageIdFromTask({ source: 'gmail', sourceId: null }), null)
})

test('retained example text is capped', () => {
  const long = 'x'.repeat(EXAMPLE_TEXT_CHARS * 3)
  const cut = truncateExample(long)
  assert.ok(cut.length <= EXAMPLE_TEXT_CHARS + 1, `got ${cut.length}`)
  assert.ok(cut.endsWith('…'), 'truncation should be visible in the stored text')
})

test('short example text is left exactly as it was', () => {
  // Equality matters: the stored string is what gets re-embedded, so any
  // rewriting here would silently change vectors on every maintenance pass.
  const short = 'Subject: lunch\nFrom: a@b.com\n\nsee you at one'
  assert.equal(truncateExample(short), short)
})

test('text at exactly the cap is not truncated', () => {
  const exact = 'y'.repeat(EXAMPLE_TEXT_CHARS)
  assert.equal(truncateExample(exact), exact)
})

test('a title containing a colon does not corrupt the message id', () => {
  // Gmail ids are hex, so the first segment is unambiguous however odd the title.
  assert.equal(
    messageIdFromTask({ source: 'gmail', sourceId: '18f2a1b3:Re: Re: fwd: budget' }),
    '18f2a1b3'
  )
})
