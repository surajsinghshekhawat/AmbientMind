import { join } from 'node:path'
import { BrowserWindow } from 'electron'

let chatWindow: BrowserWindow | null = null

export function showChatWindow() {
  if (chatWindow && !chatWindow.isDestroyed()) {
    chatWindow.show()
    chatWindow.focus()
    return chatWindow
  }

  chatWindow = new BrowserWindow({
    width: 440,
    height: 620,
    minWidth: 360,
    minHeight: 420,
    title: 'AmbientMind',
    autoHideMenuBar: true,
    // Same reason as settings: it would otherwise sit under the overlay.
    alwaysOnTop: true,
    webPreferences: {
      preload: join(__dirname, '../preload/preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false
    }
  })

  chatWindow.setAlwaysOnTop(true, 'floating')

  if (process.env.ELECTRON_RENDERER_URL) {
    void chatWindow.loadURL(`${process.env.ELECTRON_RENDERER_URL}/chat/index.html`)
  } else {
    void chatWindow.loadFile(join(__dirname, '../renderer/chat/index.html'))
  }

  chatWindow.on('closed', () => {
    chatWindow = null
  })

  return chatWindow
}

export function getChatWindow() {
  return chatWindow
}
