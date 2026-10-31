import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { installMockAmbient } from '../dev/mockAmbient'
import { App } from './App'

const flush = () => act(async () => {})

async function open(section?: Parameters<typeof App>[0]['initialSection']) {
  render(<App initialSection={section} applyTheme={false} />)
  await flush()
}

describe('Settings', () => {
  it('saves a change and says so once', async () => {
    const mock = installMockAmbient()
    await open()
    fireEvent.click(screen.getByRole('radio', { name: 'Light' }))
    await flush()
    expect(mock.state.config.theme).toBe('light')
    expect(screen.getByRole('radio', { name: 'Light' }).getAttribute('aria-checked')).toBe('true')
    await waitFor(() => expect(screen.getByText('Saved')).toBeTruthy())
  })

  it('moves between sections from the sidebar', async () => {
    installMockAmbient()
    await open()
    fireEvent.click(screen.getByRole('button', { name: 'Privacy & Data' }))
    expect(screen.getByRole('heading', { name: 'Privacy & Data' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Privacy & Data' }).getAttribute('aria-current')).toBe('page')
  })

  it('records a new shortcut with the old ones suspended', async () => {
    const mock = installMockAmbient()
    await open('shortcuts')
    const recorder = screen.getByRole('button', { name: /Change shortcut for Ask about your tasks/ })
    fireEvent.click(recorder)
    await flush()
    expect(mock.calls.filter((c) => c.method === 'suspendShortcuts').map((c) => c.args[0])).toEqual([true])
    // Modifiers alone keep it listening.
    fireEvent.keyDown(recorder, { code: 'AltLeft', key: 'Alt', altKey: true })
    expect(screen.getByText('Type keys…')).toBeTruthy()
    fireEvent.keyDown(recorder, { code: 'KeyK', key: 'k', ctrlKey: true, altKey: true })
    await flush()
    expect(mock.state.config.shortcuts).toEqual({ chat: 'Control+Alt+K' })
    expect(mock.calls.filter((c) => c.method === 'suspendShortcuts').map((c) => c.args[0])).toEqual([true, false])
    expect(screen.getByRole('button', { name: /now ⌃⌥K$/ })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Use the default' }))
    await flush()
    expect(mock.state.config.shortcuts).toEqual({})
  })

  it('a weak shortcut is refused and Esc leaves the old one', async () => {
    const mock = installMockAmbient()
    await open('shortcuts')
    const recorder = screen.getByRole('button', { name: /Change shortcut for Quick add/ })
    fireEvent.click(recorder)
    fireEvent.keyDown(recorder, { code: 'KeyA', key: 'a' })
    expect(screen.getByText(/Add ⌃, ⌥ or ⌘|Add Ctrl, Alt or Win/)).toBeTruthy()
    fireEvent.keyDown(recorder, { code: 'Escape', key: 'Escape' })
    await flush()
    expect(mock.state.config.shortcuts).toEqual({})
    expect(screen.queryByText('Type keys…')).toBeNull()
  })

  it('pauses AI and resumes it', async () => {
    const mock = installMockAmbient()
    await open('privacy')
    fireEvent.click(screen.getByRole('button', { name: 'For 1 hour' }))
    await flush()
    expect(mock.state.config.pauseAiUntil).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }))
    await flush()
    expect(mock.state.config.pauseAiUntil).toBeNull()
  })

  it('a refused permission links to System Settings and flags the sidebar', async () => {
    const mock = installMockAmbient({
      permissions: [
        { kind: 'microphone', status: 'granted', help: null, canOpenSettings: true },
        { kind: 'screen', status: 'denied', help: 'Turn it on in System Settings.', canOpenSettings: true }
      ]
    })
    await open('permissions')
    expect(screen.getByText('Turn it on in System Settings.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Open System Settings' }))
    expect(mock.calls.some((c) => c.method === 'openPermissionSettings' && c.args[0] === 'screen')).toBe(true)
    expect(screen.getByRole('button', { name: /Permissions/ }).querySelector('[aria-label="Needs attention"]')).toBeTruthy()
  })

  it('Accessibility is off, not a problem, until allowed', async () => {
    const mock = installMockAmbient({
      permissions: [
        { kind: 'microphone', status: 'granted', help: null, canOpenSettings: true },
        { kind: 'screen', status: 'granted', help: null, canOpenSettings: true },
        { kind: 'accessibility', status: 'not-determined', help: null, canOpenSettings: true }
      ]
    })
    await open('permissions')
    expect(screen.getByText('Off')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Permissions/ }).querySelector('[aria-label="Needs attention"]')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Allow' }))
    await flush()
    expect(mock.calls.some((c) => c.method === 'requestPermission' && c.args[0] === 'accessibility')).toBe(true)
    expect(screen.getAllByText('Allowed')).toHaveLength(3)
  })

  it('live words download only when asked, then take over from Whisper', async () => {
    const mock = installMockAmbient({
      speech: { engine: 'whisper', apple: { available: true, installed: false, downloading: false, locale: 'en-US' }, installing: null }
    })
    await open('capture')
    expect(mock.calls.some((c) => c.method === 'speech.install')).toBe(false)
    expect(screen.getByText('Voice model')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Download' }))
    await flush()
    expect(mock.calls.some((c) => c.method === 'speech.install')).toBe(true)
    expect(screen.getByText('On')).toBeTruthy()
    expect(screen.getByText('Fallback voice model')).toBeTruthy()
  })

  it('no live words row where Apple speech is missing', async () => {
    installMockAmbient()
    await open('capture')
    expect(screen.queryByText('Live words')).toBeNull()
  })
})
