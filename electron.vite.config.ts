import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

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
    plugins: [react(), tailwindcss()],
    build: {
      outDir: 'out/renderer',
      rollupOptions: {
        input: {
          overlay: resolve(__dirname, 'src/overlay/index.html'),
          quickadd: resolve(__dirname, 'src/quickadd/index.html'),
          settings: resolve(__dirname, 'src/settings/index.html'),
          chat: resolve(__dirname, 'src/chat/index.html')
        }
      }
    }
  }
})
