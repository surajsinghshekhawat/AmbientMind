const { app } = require('electron')
const path = require('node:path')
const fs = require('node:fs')

app.setName('ambientmind')
app.setPath('userData', path.join(app.getPath('appData'), 'ambientmind'))

app.whenReady().then(() => {
  try {
    const file = path.join(app.getPath('userData'), 'secrets.json')
    const exists = fs.existsSync(file)
    console.log('SECRETS_FILE', exists)
    if (!exists) {
      process.exit(0)
      return
    }
    const { safeStorage } = require('electron')
    const map = JSON.parse(fs.readFileSync(file, 'utf8'))
    const encoded = map['google.tokens']
    console.log('HAS_GOOGLE_TOKENS', Boolean(encoded))
    if (!encoded) {
      process.exit(0)
      return
    }
    const raw = safeStorage.decryptString(Buffer.from(encoded, 'base64'))
    const tokens = JSON.parse(raw)
    console.log('HAS_REFRESH', Boolean(tokens.refreshToken))
    console.log('EMAIL', tokens.email || '(none)')
    console.log('EXPIRES', tokens.expiresAt ? new Date(tokens.expiresAt).toISOString() : '(none)')
    process.exit(0)
  } catch (err) {
    console.error('CHECK_FAIL', err.message)
    process.exit(1)
  }
})
