import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

// Must be main.ts's first import: paths have to be redirected before any other
// module resolves userData. Unpackaged runs keep all app state in the repo's
// .local/data rather than ~/Library; ./dev also opts packaged test builds in.
const dataDir =
  process.env.AMBIENTMIND_DATA_DIR ??
  (app.isPackaged ? undefined : join(app.getAppPath(), '.local', 'data'))

export const isIsolated = dataDir !== undefined

if (dataDir) {
  const paths = [
    ['userData', ''],
    ['sessionData', 'session'],
    ['logs', 'logs'],
    ['crashDumps', 'crashes']
  ] as const
  for (const [name, sub] of paths) {
    const dir = join(dataDir, sub)
    mkdirSync(dir, { recursive: true })
    app.setPath(name, dir)
  }
  // Chromium and safeStorage otherwise create a "<name> Safe Storage" item in
  // the login keychain.
  app.commandLine.appendSwitch('use-mock-keychain')
}
