// Electron scripts share the dev app's profile, which lives inside the repo.
// Must run before app 'ready'.
const fs = require('node:fs')
const path = require('node:path')

function useProjectUserData(app) {
  const dir = process.env.AMBIENTMIND_DATA_DIR || path.join(__dirname, '..', '.local', 'data')
  const sessionDir = path.join(dir, 'session')
  fs.mkdirSync(sessionDir, { recursive: true })
  app.setPath('userData', dir)
  // Chromium's profile (caches, storage) otherwise stays in ~/Library.
  app.setPath('sessionData', sessionDir)
  // Chromium otherwise creates a "<name> Safe Storage" item in the login keychain.
  app.commandLine.appendSwitch('use-mock-keychain')
  return dir
}

module.exports = { useProjectUserData }
