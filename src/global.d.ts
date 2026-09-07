import type { AmbientApi } from '../electron/preload'

declare global {
  interface Window {
    ambient: AmbientApi
  }
}

export {}
