import { existsSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

/** Passed to the relaunched app, which erases before anything opens a file. */
export const ERASE_FLAG = '--erase-data'

/** Describes the app's Google client rather than the user, and takes a while to set up again. */
const KEEP = new Set(['google-credentials.json'])

/** Empties the data folder and removes the crash log, which lives elsewhere. */
export function eraseUserData(dataFolder: string, crashLog: string): void {
  if (existsSync(dataFolder)) {
    for (const name of readdirSync(dataFolder)) {
      if (!KEEP.has(name)) rmSync(join(dataFolder, name), { recursive: true, force: true })
    }
  }
  rmSync(crashLog, { force: true })
}
