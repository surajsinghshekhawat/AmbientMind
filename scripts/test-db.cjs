/**
 * Runs db/tests under Electron's own Node, because better-sqlite3 is compiled
 * against Electron's ABI and cannot be loaded by the plain Node that runs
 * test:logic.
 */
const { spawnSync } = require('node:child_process')
const { readdirSync } = require('node:fs')
const path = require('node:path')
const electron = require('electron')

const dir = path.join(__dirname, '..', 'db', 'tests')
const files = readdirSync(dir)
  .filter((name) => name.endsWith('.test.ts'))
  .map((name) => path.join('db', 'tests', name))

const result = spawnSync(
  electron,
  ['--require', './db/tests/raw-require.cjs', '--test', ...files],
  {
    cwd: path.join(__dirname, '..'),
    stdio: 'inherit',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
  }
)
process.exit(result.status ?? 1)
