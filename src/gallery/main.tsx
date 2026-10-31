import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { installMockAmbient } from '../dev/mockAmbient'
import { Gallery } from './Gallery'
import '../app.css'

installMockAmbient()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Gallery />
  </StrictMode>
)
