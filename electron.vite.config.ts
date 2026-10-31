import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { contentSecurityPolicy } from './electron/security'

/**
 * Built pages load from file://, where Electron never sees response headers,
 * so the production policy has to live in the page itself. The dev server
 * gets the dev policy as a header from main.ts instead.
 */
function cspMeta(): Plugin {
  return {
    name: 'ambientmind-csp-meta',
    apply: 'build',
    transformIndexHtml: () => [
      {
        tag: 'meta',
        attrs: { 'http-equiv': 'Content-Security-Policy', content: contentSecurityPolicy() },
        injectTo: 'head-prepend'
      }
    ]
  }
}

const alias = {
  '@shared': resolve(__dirname, 'shared'),
  '@': resolve(__dirname, 'src')
}

export default defineConfig({
  main: {
    resolve: { alias },
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'out/main',
      lib: { entry: resolve(__dirname, 'electron/main.ts') }
    }
  },
  preload: {
    resolve: { alias },
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'out/preload',
      lib: { entry: resolve(__dirname, 'electron/preload.ts') }
    }
  },
  renderer: {
    root: 'src',
    resolve: { alias },
    plugins: [react(), tailwindcss(), cspMeta()],
    build: {
      outDir: 'out/renderer',
      minify: true,
      rollupOptions: {
        input: {
          overlay: resolve(__dirname, 'src/overlay/index.html'),
          quickadd: resolve(__dirname, 'src/quickadd/index.html'),
          settings: resolve(__dirname, 'src/settings/index.html'),
          chat: resolve(__dirname, 'src/chat/index.html'),
          onboarding: resolve(__dirname, 'src/onboarding/index.html')
        }
      }
    }
  }
})
