import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const flush = () => act(async () => {})

/** `clientOs` is read once at import, so each platform gets a fresh module graph. */
async function settingsOn(userAgent: string, section: 'about' | 'data' | 'privacy') {
  vi.resetModules()
  vi.stubGlobal('navigator', { ...navigator, userAgent })
  const { installMockAmbient } = await import('../dev/mockAmbient')
  const { App } = await import('./App')
  const mock = installMockAmbient()
  render(<App initialSection={section} applyTheme={false} />)
  await flush()
  return mock
}

const PLATFORMS = [
  { name: 'Windows', userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', device: 'this PC', folder: 'Show in Explorer' },
  { name: 'macOS', userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', device: 'this Mac', folder: 'Show in Finder' }
]

afterEach(() => {
  vi.unstubAllGlobals()
})

describe.each(PLATFORMS)('Settings on $name', ({ userAgent, device, folder }) => {
  it('About opens the policy, terms and licences', async () => {
    const mock = await settingsOn(userAgent, 'about')
    for (const [label, doc] of [['Privacy policy', 'privacy'], ['Terms of use', 'terms'], ['Open-source licences', 'notices']] as const) {
      const row = screen.getByText(label).closest('div')!.parentElement!
      act(() => row.querySelector('button')!.click())
      expect(mock.calls.at(-1)).toEqual({ method: 'openLegal', args: [doc] })
    }
  })

  it('Your data names this computer and offers to erase everything', async () => {
    const mock = await settingsOn(userAgent, 'data')
    expect(screen.getByRole('button', { name: folder })).toBeTruthy()
    expect(screen.getByText(new RegExp(`deletes all AmbientMind keeps on ${device}`))).toBeTruthy()
    act(() => screen.getByRole('button', { name: 'Erase…' }).click())
    await flush()
    expect(mock.calls.some((call) => call.method === 'privacy.eraseAll')).toBe(true)
  })

  it('Privacy says downloads show your IP address', async () => {
    await settingsOn(userAgent, 'privacy')
    expect(screen.getByText(/like any download, the site sees your IP address/)).toBeTruthy()
    expect(screen.getByText(new RegExp(`What leaves ${device}`))).toBeTruthy()
  })
})
