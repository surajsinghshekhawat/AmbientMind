import { act, render, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { installMockAmbient } from '../dev/mockAmbient'
import { App } from './App'

it('asks for health again when settings change, so a resumed AI stops showing as paused', async () => {
  const mock = installMockAmbient()
  const getHealth = vi.spyOn(window.ambient, 'getHealth')
  render(<App />)
  await waitFor(() => expect(getHealth).toHaveBeenCalled())
  const before = getHealth.mock.calls.length
  const config = await window.ambient.getConfig()
  act(() => mock.emit.configChanged({ ...config, pauseAiUntil: null }))
  await waitFor(() => expect(getHealth.mock.calls.length).toBeGreaterThan(before))
})
