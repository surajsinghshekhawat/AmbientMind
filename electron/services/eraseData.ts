import { existsSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

/** Passed to the relaunched app, which erases before anything opens a file. */
export const ERASE_FLAG = '--erase-data'

/** Describes the app's Google client rather than the user, and takes a while to set up again. */
const KEEP = new Set(['google-credentials.json'])

/**
 * Windows refuses to delete a file another process has open, and the instance
 * that asked for the erase may still be letting go of the database.
 */
const RETRY = { maxRetries: 10, retryDelay: 200 }

/**
 * Empties the data folder and removes the crash log, which on a Mac lives
 * elsewhere. Never throws: it runs before the app is up. Returns whatever
 * could not be removed, so the user can be told.
 */
export function eraseUserData(dataFolder: string, crashLog: string): string[] {
  const left: string[] = []
  const remove = (path: string) => {
    try {
      rmSync(path, { recursive: true, force: true, ...RETRY })
    } catch {
      left.push(path)
    }
  }
  try {
    if (existsSync(dataFolder)) {
      for (const name of readdirSync(dataFolder)) if (!KEEP.has(name)) remove(join(dataFolder, name))
    }
  } catch {
    left.push(dataFolder)
  }
  remove(crashLog)
  return left
}
