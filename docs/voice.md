# Voice input

Press **Ctrl+Shift+A** to open QuickAdd, then click the mic. Speak a task,
click the mic again to stop. AmbientMind transcribes locally and submits.

## Two routes from one utterance

| You say | What happens |
| --- | --- |
| "buy milk tomorrow" | Quick-add + LLM enrichment (deadline, priority) |
| "add what's on my screen" / "add this to my tasks" | Same pipeline as **Ctrl+Shift+S** |

Intent detection lives in `shared/voiceIntent.ts` and applies to typed text
too, so the same phrasing works without the mic.

## Why Transformers.js and not whisper.cpp

Native whisper.cpp bindings need rebuilding for Electron's Node ABI. This
project already hit that cost with `better-sqlite3`. `@xenova/transformers`
runs `whisper-tiny.en` as ONNX (~75MB, cached under `%APPDATA%/ambientmind/whisper`)
with no compile step. Cold start is a few seconds the first time in a session;
the model is warmed in the background after launch.

Tradeoff: tiny.en occasionally mishears a word ("buy" → "by"). That is
acceptable for v1 push-to-talk; a larger English model can replace the ID in
`electron/services/speech.ts` later without touching the UI.

## Audio path

1. QuickAdd requests the mic (`getUserMedia`).
2. `PcmRecorder` captures mono float32 and resamples to 16 kHz in the renderer.
3. Main process runs Whisper and returns a transcript.
4. Submit follows the intent table above.

The QuickAdd window does not dismiss on blur while recording, because granting
the mic can briefly steal focus.

## Not in v1

- Always-on wake word ("hey AmbientMind") — custom wake-word engines are paid
  or unreliable; push-to-talk covers the same intent for free.
- Continuous dictation into the overlay.
