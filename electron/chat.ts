import { join } from 'node:path'
import { BrowserWindow } from 'electron'
import { bringToFront, prepareUtilityWindow, utilityWindowOptions } from './platform'

let chatWindow: BrowserWindow | null = null
let closing = false

export function showChatWindow() {
  if (chatWindow && !chatWindow.isDestroyed()) {
    // Showing a window that is being torn down can take the app with it;
    // open a fresh one once it has gone.
    if (closing) chatWindow.once('closed', () => showChatWindow())
    else bringToFront(chatWindow)
    return chatWindow
  }

  // The same glass card as the panel. Frameless, so the page draws its own
  // header (a drag region) and Esc or the close button closes it.
  chatWindow = new BrowserWindow({
    width: 460,
    height: 600,
    minWidth: 380,
    minHeight: 360,
    title: 'Ask AmbientMind',
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
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

  chatWindow.on('close', () => {
    closing = true
  })
  chatWindow.on('closed', () => {
    chatWindow = null
    closing = false
  })

  bringToFront(chatWindow)
  return chatWindow
}

export function getChatWindow() {
  return chatWindow
}
