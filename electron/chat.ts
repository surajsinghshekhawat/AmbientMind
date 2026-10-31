import { join } from 'node:path'
import { BrowserWindow } from 'electron'
import { bringToFront, prepareUtilityWindow, utilityWindowOptions } from './platform'

let chatWindow: BrowserWindow | null = null

export function showChatWindow() {
  if (chatWindow && !chatWindow.isDestroyed()) {
    bringToFront(chatWindow)
    return chatWindow
  }

  chatWindow = new BrowserWindow({
    width: 440,
    height: 620,
    minWidth: 360,
    minHeight: 420,
    title: 'AmbientMind',
    ...utilityWindowOptions,
    webPreferences: {
      preload: join(__dirname, '../preload/preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  })

  prepareUtilityWindow(chatWindow, 'chat')

  if (process.env.ELECTRON_RENDERER_URL) {
    void chatWindow.loadURL(`${process.env.ELECTRON_RENDERER_URL}/chat/index.html`)
  } else {
    void chatWindow.loadFile(join(__dirname, '../renderer/chat/index.html'))
  }

  chatWindow.on('closed', () => {
    chatWindow = null
  })

  bringToFront(chatWindow)
  return chatWindow
}

export function getChatWindow() {
  return chatWindow
}
