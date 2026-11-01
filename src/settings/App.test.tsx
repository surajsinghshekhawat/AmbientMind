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
    fireEvent.click(screen.getByRole('button', { name: 'Your data' }))
    await flush()
    expect(screen.getByRole('heading', { name: 'Your data' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Your data' }).getAttribute('aria-current')).toBe('page')
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
    fireEvent.click(screen.getByRole('button', { name: 'Until I resume' }))
    await flush()
    expect(screen.getByText(/until you resume it/)).toBeTruthy()
  })

  it('shows where requests went and hides windows from screen sharing', async () => {
    const mock = installMockAmbient()
    await open('privacy')
    expect(screen.getByText('Google (Gmail and Calendar)')).toBeTruthy()
    expect(screen.getByText('2 requests')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Show' }))
    await flush()
    expect(screen.getByRole('list', { name: 'Recent requests' }).textContent).toContain('gmail.googleapis.com/gmail/v1/users/me/messages')
    fireEvent.click(screen.getByRole('switch', { name: 'Hide from screen sharing' }))
    await flush()
    expect(mock.state.config.contentProtection).toBe(true)
    expect(mock.state.config.quietMode).toBe(true)
  })

  it('counts what is kept and forgets a source, by date, or the chat', async () => {
    const mock = installMockAmbient()
    await open('data')
    expect(screen.getByText('4 open · 12 finished')).toBeTruthy()
    fireEvent.click(screen.getAllByRole('button', { name: 'Forget…' })[0]!)
    await flush()
    expect(mock.calls).toContainEqual({ method: 'privacy.forgetSource', args: ['gmail'] })
    expect(screen.queryByText('4 open · 12 finished')).toBeNull()
    await waitFor(() => expect(screen.getByText('Forgot 16 items')).toBeTruthy())

    fireEvent.change(screen.getByRole('combobox', { name: 'Older than' }), { target: { value: '365' } })
    fireEvent.click(screen.getAllByRole('button', { name: 'Forget…' }).at(-1)!)
    await flush()
    expect(mock.calls).toContainEqual({ method: 'privacy.forgetBefore', args: [365] })

    fireEvent.click(screen.getAllByRole('button', { name: 'Clear…' })[0]!)
    await flush()
    expect(mock.state.inventory.chatTurns).toBe(0)
  })

  it('keeps backup and restore behind a passphrase', async () => {
    const mock = installMockAmbient()
    await open('data')
    const restore = screen.getByRole('button', { name: 'Restore…' })
    expect(restore.hasAttribute('disabled')).toBe(true)
    fireEvent.change(screen.getByLabelText('Passphrase'), { target: { value: 'correct horse' } })
    fireEvent.click(screen.getByRole('button', { name: 'Restore…' }))
    await flush()
    expect(mock.calls).toContainEqual({ method: 'restoreBackup', args: ['correct horse'] })
  })

  it('screen reading starts off and takes a list of apps never to read', async () => {
    const mock = installMockAmbient()
    await open('capture')
    expect(screen.queryByLabelText(/Never read/)).toBeNull()
    fireEvent.click(screen.getByRole('switch', { name: 'Read the screen' }))
    await flush()
    expect(mock.state.config.screenReading).toBe(true)
    const field = screen.getByLabelText(/Never read/)
    fireEvent.change(field, { target: { value: 'Messages\n\n messages \ncom.tinyspeck.slackmacgap' } })
    fireEvent.blur(field)
    await flush()
    expect(mock.state.config.excludedApps).toEqual(['Messages', 'com.tinyspeck.slackmacgap'])
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

  it('turning on Reminders asks main, then says where tasks go', async () => {
    const mock = installMockAmbient()
    mock.state.appleSources = { ...mock.state.appleSources, available: true }
    await open('sources')
    expect(screen.queryByText('Coming soon')).toBeNull()
    fireEvent.click(screen.getByRole('switch', { name: 'Reminders' }))
    await flush()
    expect(mock.calls).toContainEqual({ method: 'appleSources.set', args: ['reminders', true] })
    expect(screen.getByRole('switch', { name: 'Reminders' }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByText(/0 tasks in AmbientMind · iCloud/)).toBeTruthy()
  })

  it('a refused Calendar permission says why and leaves the switch off', async () => {
    const mock = installMockAmbient({
      appleSourceError: 'Calendar access is off for AmbientMind. Turn it on in System Settings → Privacy & Security → Calendars.'
    })
    mock.state.appleSources = { ...mock.state.appleSources, available: true }
    await open('sources')
    fireEvent.click(screen.getByRole('switch', { name: 'Apple Calendar' }))
    await flush()
    expect(screen.getByText(/Calendar access is off for AmbientMind/)).toBeTruthy()
    expect(screen.getByRole('switch', { name: 'Apple Calendar' }).getAttribute('aria-checked')).toBe('false')
  })

  it('no Apple sources off the Mac', async () => {
    installMockAmbient({ permissions: [{ kind: 'microphone', status: 'granted', help: null, canOpenSettings: true }] })
    await open('sources')
    expect(screen.queryByText('On this Mac')).toBeNull()
  })

  it('shows which engine answers and switches between them', async () => {
    const mock = installMockAmbient()
    await open('ai')
    // The status row and the "Answering now" pill.
    expect(screen.getAllByText('Apple Intelligence')).toHaveLength(2)
    expect(screen.getByText('On this Mac, private and fast.')).toBeTruthy()
    fireEvent.click(screen.getByRole('radio', { name: 'Ollama' }))
    await flush()
    expect(mock.state.config.aiEngine).toBe('ollama')
  })

  it('says why Apple Intelligence is off, and hides the engine choice off the Mac', async () => {
    const mock = installMockAmbient()
    mock.state.health = { ...mock.state.health, ai: { preference: 'auto', engine: 'ollama', apple: { available: false, reason: 'not_enabled' } } }
    await open('ai')
    expect(screen.getByText(/Turn on Apple Intelligence in System Settings/)).toBeTruthy()

    mock.state.health = { ...mock.state.health, ai: { preference: 'auto', engine: 'ollama', apple: null } }
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }))
    await flush()
    expect(screen.queryByRole('radiogroup', { name: 'AI engine' })).toBeNull()
  })

  it('confident mail tasks skip Suggested only when asked', async () => {
    const mock = installMockAmbient()
    await open('ai')
    const toggle = screen.getByRole('switch', { name: 'Add confident tasks straight away' })
    expect(toggle.getAttribute('aria-checked')).toBe('false')
    fireEvent.click(toggle)
    await flush()
    expect(mock.state.config.autoAcceptAbove).toBe(0.9)
  })

  it('no live words row where Apple speech is missing', async () => {
    installMockAmbient()
    await open('capture')
    expect(screen.queryByText('Live words')).toBeNull()
  })
})
