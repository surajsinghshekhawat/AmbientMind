import assert from 'node:assert/strict'
import test from 'node:test'
import { cleanTranscript } from '../shared/transcript'

test("Whisper's sound labels alone make an empty transcript", () => {
  assert.equal(cleanTranscript(' (dog barking)'), '')
  assert.equal(cleanTranscript('[BLANK_AUDIO]'), '')
  assert.equal(cleanTranscript('[Music] (applause)'), '')
})

test('speech around a sound label is kept', () => {
  assert.equal(cleanTranscript(' [Music] Call mum tomorrow at 6'), 'Call mum tomorrow at 6')
  assert.equal(cleanTranscript('Buy milk (laughs) and eggs'), 'Buy milk and eggs')
  assert.equal(cleanTranscript('  Pay rent  '), 'Pay rent')
})
