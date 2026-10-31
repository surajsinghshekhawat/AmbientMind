import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { sampleRule, sampleSuggestion } from '../dev/fixtures'
import { installMockAmbient } from '../dev/mockAmbient'
import { Gallery } from './Gallery'
import '../app.css'

installMockAmbient({
  rules: [sampleRule(), { ...sampleRule(), id: 'rule-2', title: 'Tuition', weekdays: [2, 4, 6], time: '17:00', enabled: false }],
  suggestions: [sampleSuggestion()],
  learned: [
    { title: 'Weekly digest from Product Hunt', deletes: 5 },
    { title: 'Rate your recent order', deletes: 3 }
  ],
  permissions: [
    { kind: 'microphone', status: 'granted', help: null, canOpenSettings: true },
    {
      kind: 'screen',
      status: 'denied',
      help: 'Turn on AmbientMind in Privacy & Security → Screen Recording, then reopen it.',
      canOpenSettings: true
    },
    { kind: 'accessibility', status: 'not-determined', help: null, canOpenSettings: true }
  ],
  speech: { engine: 'whisper', apple: { available: true, installed: false, downloading: false, locale: 'en-US' }, installing: null },
  appleSources: {
    available: true,
    calendar: { enabled: true, access: 'granted', lastRun: new Date(Date.now() - 2 * 60_000).toISOString(), lastError: null, upcoming: 2 },
    reminders: { enabled: false, access: 'not-determined', lastRun: null, lastError: null, list: null, linked: 0 }
  }
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Gallery />
  </StrictMode>
)
