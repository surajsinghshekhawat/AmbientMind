import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'e2e',
  outputDir: '.local/playwright',
  timeout: 90_000,
  workers: 1,
  reporter: 'list'
})
