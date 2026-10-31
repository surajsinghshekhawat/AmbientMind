import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { googleDisconnectedReport, manyProblemsReport } from '../dev/fixtures'
import { installMockAmbient } from '../dev/mockAmbient'
import { HealthBanner } from './HealthBanner'

const noop = () => {}

describe('HealthBanner', () => {
  it('shows the first problem and how many more there are', () => {
    render(<HealthBanner health={manyProblemsReport()} connecting={false} onConnectGoogle={noop} onRecheck={noop} />)

    expect(screen.getByText(/Ollama is not reachable/)).toBeTruthy()
    expect(screen.getByText('+2 more in Settings')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Connect Google' })).toBeNull()
  })

  it('offers Connect Google only when sign-in is set up but not connected', () => {
    render(
      <HealthBanner health={googleDisconnectedReport()} connecting={false} onConnectGoogle={noop} onRecheck={noop} />
    )
    expect(screen.getByRole('button', { name: 'Connect Google' })).toBeTruthy()
  })

  it('opens Settings through the bridge', () => {
    const mock = installMockAmbient()
    render(<HealthBanner health={manyProblemsReport()} connecting={false} onConnectGoogle={noop} onRecheck={noop} />)

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    expect(mock.calls).toContainEqual({ method: 'openSettings', args: [] })
  })
})
