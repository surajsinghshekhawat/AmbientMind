import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { installMockAmbient } from '../dev/mockAmbient'
import { App } from './App'

const flush = () => act(async () => {})

describe('Onboarding', () => {
  it('walks every step and finishes once', async () => {
    const mock = installMockAmbient()
    render(<App applyTheme={false} />)
    await flush()
    expect(screen.getByRole('heading', { name: 'Meet AmbientMind' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Get started' }))
    expect(screen.getByRole('heading', { name: 'It stays on this Mac' })).toBeTruthy()
    for (let i = 0; i < 4; i++) fireEvent.click(screen.getByRole('button', { name: /Continue|Skip for now/ }))
    expect(screen.getByRole('heading', { name: 'You’re set' })).toBeTruthy()
    expect(screen.getByText('⌃⌥Space')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Start using AmbientMind' }))
    expect(mock.calls.filter((c) => c.method === 'finishOnboarding')).toHaveLength(1)
    expect(mock.state.config.onboarded).toBe(true)
  })

  it('Enter moves on when no control has focus', async () => {
    installMockAmbient()
    render(<App applyTheme={false} />)
    await flush()
    fireEvent.keyDown(document.body, { key: 'Enter' })
    expect(screen.getByRole('heading', { name: 'It stays on this Mac' })).toBeTruthy()
  })

  it('Back returns to the previous step', async () => {
    installMockAmbient()
    render(<App initialStep="sources" applyTheme={false} />)
    await flush()
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByRole('heading', { name: 'It stays on this Mac' })).toBeTruthy()
  })

  it('asks for the microphone only when macOS has not asked yet', async () => {
    const mock = installMockAmbient({
      permissions: [
        { kind: 'microphone', status: 'not-determined', help: null, canOpenSettings: true },
        { kind: 'screen', status: 'granted', help: null, canOpenSettings: true }
      ]
    })
    const stop = vi.fn()
    const getUserMedia = vi.fn(async () => {
      mock.state.permissions = [{ ...mock.state.permissions[0]!, status: 'granted' }, mock.state.permissions[1]!]
      return { getTracks: () => [{ stop }] }
    })
    Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia }, configurable: true })
    render(<App initialStep="permissions" applyTheme={false} />)
    await flush()
    fireEvent.click(screen.getByRole('button', { name: 'Allow' }))
    await flush()
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true })
    expect(stop).toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Allow' })).toBeNull()
    // Screen Recording only matters once screen reading is on.
    expect(screen.getAllByText('Allowed')).toHaveLength(1)
    fireEvent.click(screen.getByRole('switch', { name: 'Read the screen' }))
    await flush()
    expect(mock.state.config.screenReading).toBe(true)
    expect(screen.getAllByText('Allowed')).toHaveLength(2)
  })

  it('a connected Gmail turns Skip into Continue', async () => {
    installMockAmbient()
    render(<App initialStep="sources" applyTheme={false} />)
    await flush()
    expect(screen.getByText('Connected as me@example.com')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Continue' })).toBeTruthy()
  })
})
