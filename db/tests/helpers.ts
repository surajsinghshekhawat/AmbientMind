import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { after } from 'node:test'
import { closeTaskStore, openTaskStore } from '../../electron/services/taskStore'

const root = mkdtempSync(join(process.env.TMPDIR ?? join(process.cwd(), '.local', 'tmp'), 'am-db-'))
after(() => rmSync(root, { recursive: true, force: true }))

let counter = 0

/**
 * A fresh, fully migrated store per test; the module-level handle points at
 * it, and the Electron stub's userData points at a matching empty folder.
 */
export function freshStore() {
  closeTaskStore()
  const dir = join(root, `t${++counter}`)
  mkdirSync(dir)
  process.env.AM_TEST_USERDATA = dir
  return openTaskStore(join(dir, 'ambientmind.db'))
}

type FetchHandler = (url: string, init?: RequestInit) => Response | Promise<Response>

/** Replaces global fetch for one test; restore with the returned function. */
export function mockFetch(handler: FetchHandler): () => void {
  const original = globalThis.fetch
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) =>
    handler(typeof input === 'string' ? input : input.toString(), init)) as typeof fetch
  return () => {
    globalThis.fetch = original
  }
}

export const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
