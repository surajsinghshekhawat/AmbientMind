import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach } from 'vitest'
import { installMockAmbient } from '../dev/mockAmbient'

// Every test starts with a fresh, empty bridge; tests that need data call
// installMockAmbient again with their own state.
beforeEach(() => {
  installMockAmbient()
})

afterEach(() => {
  cleanup()
})
