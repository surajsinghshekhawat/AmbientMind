import assert from 'node:assert/strict'
import test from 'node:test'
import { buildScreenTaskPrompt } from '../prompts/screenTask'
import { EXCLUDED_BUNDLE_IDS, denoiseOcr, focusedText, windowTitle } from '../shared/screenRead'

test('the window title names the app once', () => {
  assert.equal(windowTitle({ app: 'Mail', title: 'Re: Budget' }), 'Mail — Re: Budget')
  assert.equal(windowTitle({ app: 'Notes', title: 'Notes' }), 'Notes')
  assert.equal(windowTitle({ app: 'Finder', title: null }), 'Finder')
  assert.equal(windowTitle({ app: null, title: '  ' }), '')
})

test('the selection leads, then the address, then the window text', () => {
  const text = focusedText({ selectedText: ' Ship by Friday ', url: 'https://example.com/t/12', text: 'Ticket 12\nShip the fix' })
  assert.equal(text, 'Selected text:\nShip by Friday\n\nAddress: https://example.com/t/12\n\nTicket 12\nShip the fix')
  assert.equal(focusedText({ text: 'only body' }), 'only body')
  assert.equal(focusedText({ selectedText: null, url: null }), '')
})

test('focused text is capped for the prompt', () => {
  assert.equal(focusedText({ text: 'x'.repeat(10_000) }).length, 6000)
})

test('OCR denoise keeps words in any script and drops chrome', () => {
  const text = denoiseOcr('File Edit View\n•• | ••\nok\nRéunion à 15 h avec Amélie\n12:41 ▾ ⌘')
  assert.equal(text, 'File Edit View\nRéunion à 15 h avec Amélie')
})

test('password managers are on the never-read list', () => {
  for (const id of ['com.1password.1password', 'com.bitwarden.desktop', 'com.apple.Passwords', 'com.apple.keychainaccess']) {
    assert.ok(EXCLUDED_BUNDLE_IDS.includes(id), id)
  }
})

test('the screen prompt says where its text came from', () => {
  const base = { userName: 'Suraj', instruction: 'none', currentTime: 'now', windowTitle: 'Mail', screenText: 'hi' }
  const exact = buildScreenTaskPrompt({ ...base, source: 'accessibility' })
  assert.match(exact.system, /directly from the foreground window/)
  assert.match(exact.user, /SCREEN TEXT \(read from the window\)/)
  const ocr = buildScreenTaskPrompt(base)
  assert.match(ocr.system, /by OCR/)
  assert.match(ocr.user, /SCREEN TEXT \(OCR\)/)
  assert.ok(!/\{\w+\}/.test(exact.system + exact.user + ocr.system + ocr.user), 'no unfilled placeholders')
})
