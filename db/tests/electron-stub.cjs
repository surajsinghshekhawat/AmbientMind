// Just enough of Electron's main-process API for services to run under
// node:test. Paths come from AM_TEST_USERDATA, which helpers.ts points at a
// throwaway folder inside the repo.
const userData = () => process.env.AM_TEST_USERDATA

const app = {
  isPackaged: false,
  getPath: () => userData(),
  getAppPath: () => userData(),
  getName: () => 'ambientmind-test',
  getVersion: () => '0.0.0-test'
}

const safeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (text) => Buffer.from(`stub:${text}`),
  decryptString: (buffer) => buffer.toString().replace(/^stub:/, '')
}

const shell = { openExternal: async () => undefined }

class Notification {
  show() {}
}

module.exports = { app, safeStorage, shell, Notification }
