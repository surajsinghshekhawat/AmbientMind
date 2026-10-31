import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { after } from 'node:test'
import { closeTaskStore, openTaskStore } from '../../electron/services/taskStore'

const root = mkdtempSync(join(process.env.TMPDIR ?? join(process.cwd(), '.local', 'tmp'), 'am-db-'))
after(() => rmSync(root, { recursive: true, force: true }))

let counter = 0

/** A fresh, fully migrated store per test; the module-level handle points at it. */
export function freshStore() {
  closeTaskStore()
  return openTaskStore(join(root, `t${++counter}.db`))
}
