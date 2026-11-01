import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App, isSectionId } from './App'
import '../app.css'

const hash = location.hash.slice(1)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App initialSection={isSectionId(hash) ? hash : undefined} />
  </StrictMode>
)
