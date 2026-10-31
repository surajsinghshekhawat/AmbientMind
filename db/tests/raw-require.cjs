const { readFileSync } = require('node:fs')

require('tsx/cjs')

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
