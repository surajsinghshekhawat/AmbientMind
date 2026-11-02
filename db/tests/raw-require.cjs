const Module = require('node:module')
const path = require('node:path')
const { readFileSync } = require('node:fs')

require('tsx/cjs')

// Under ELECTRON_RUN_AS_NODE, `electron` resolves to the npm package, which
// exports a path string. Services get the stub instead.
const stub = path.join(__dirname, 'electron-stub.cjs')
const resolve = Module._resolveFilename
Module._resolveFilename = function (request, ...rest) {
  if (request === 'electron') return stub
  return resolve.call(this, request, ...rest)
}

// tsx compiles the services to CommonJS and keeps Vite's `?raw` query on the
// filename (`001_init.sql?raw=`), so Node routes it to the .js loader. Catch
// those there and hand back the file's text the way Vite would.
const loadJs = require.extensions['.js']
require.extensions['.js'] = function (module, filename) {
  const raw = /\?raw=?$/.exec(filename)
  if (!raw) return loadJs.call(this, module, filename)
  module.exports = {
    __esModule: true,
    default: readFileSync(filename.slice(0, raw.index), 'utf8')
  }
}
